// Basic Investigator Tool Loop — the actual agentic loop.
//
//   LLM -> tool call -> tool execution -> result -> LLM -> ... -> answer
//
// Scope: sequential multi-tool investigation for a user question such as
// "Why did gross margin fall in August?". Correctness of the final answer
// is NOT required yet — only that the agent can call multiple tools in
// sequence with max iterations, retries, malformed-response handling,
// cancellation, and persistence of every step.
//
// Persistence (existing Prisma models, reused):
//   - AgentRun: one row per loop invocation (input/output/status).
//   - AgentStep: one row per LLM turn + one row per tool execution.
//   - IncidentEvidence: one row per tool execution (input/output/summary).

import type { PrismaClient } from "@prisma/client";
import {
  InvestigatorError,
  type InvestigatorClient,
  type LlmMessage,
} from "../ai/investigator-client";
import { executeAgentTool, getOpenAITools } from "../tools/openai";
import type { ToolContext } from "../tools/types";

export const INVESTIGATOR_SYSTEM_PROMPT =
  "You are a CFO investigation assistant. Answer the user's financial question " +
  "by calling the provided tools. Reason step by step, call one tool at a time, " +
  "and only give the final answer as JSON once you have enough evidence. " +
  "Never invent numbers — every figure must come from a tool result.";

const ANSWER_SCHEMA = {
  name: "investigation_answer",
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      findings: { type: "array", items: { type: "string" } },
      needsMoreEvidence: { type: "boolean" },
    },
    required: ["summary"],
    additionalProperties: false,
  },
};

export interface LoopOptions {
  db: PrismaClient;
  llm: InvestigatorClient;
  toolCtx: ToolContext;
  orgId: string;
  incidentId: string;
  question: string;
  /** Max LLM turns (default 8). Tool executions within a turn don't add turns. */
  maxIterations?: number;
  /** Max retries per failed LLM call (default 2). */
  maxLlmRetries?: number;
  actorId?: string;
  signal?: AbortSignal;
  onStep?: (step: { seq: number; kind: string; detail: string }) => void;
}

export type LoopStatus = "COMPLETED" | "MAX_ITERATIONS" | "FAILED" | "CANCELLED";

export interface LoopResult {
  status: LoopStatus;
  answer: unknown;
  runId: string;
  iterations: number;
  toolCallsExecuted: number;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new InvestigatorError("TIMEOUT", "Investigation cancelled", false);
  }
}

export async function runInvestigatorLoop(opts: LoopOptions): Promise<LoopResult> {
  const {
    db,
    llm,
    toolCtx,
    orgId,
    incidentId,
    question,
    maxIterations = 8,
    maxLlmRetries = 2,
    signal,
  } = opts;

  const run = await db.agentRun.create({
    data: {
      orgId,
      incidentId,
      status: "RUNNING",
      input: { question } as never,
      modelName: "investigator-loop",
    },
  });
  const runId = run.id as string;
  let seq = 0;

  const persistStep = async (step: {
    toolName?: string | null;
    input?: unknown;
    output?: unknown;
    reasoning?: string | null;
    status: "PENDING" | "RUNNING" | "OK" | "ERROR";
  }) => {
    seq += 1;
    opts.onStep?.({ seq, kind: step.toolName ? `tool:${step.toolName}` : "llm", detail: step.reasoning ?? "" });
    await db.agentStep.create({
      data: {
        runId,
        seq,
        toolName: step.toolName ?? null,
        input: (step.input ?? {}) as never,
        output: (step.output ?? {}) as never,
        reasoning: step.reasoning ?? null,
        status: step.status,
      },
    });
  };

  const finishRun = async (
    status: "COMPLETED" | "FAILED" | "CANCELLED",
    output: unknown,
  ): Promise<void> => {
    await db.agentRun.update({
      where: { id: runId },
      data: { status, output: (output ?? {}) as never, finishedAt: new Date() },
    });
  };

  const messages: LlmMessage[] = [
    { role: "system", content: INVESTIGATOR_SYSTEM_PROMPT },
    { role: "user", content: question },
  ];
  const tools = getOpenAITools();

  let iterations = 0;
  let toolCallsExecuted = 0;
  let answer: unknown = null;

  try {
    while (iterations < maxIterations) {
      throwIfCancelled(signal);
      iterations += 1;

      // --- LLM turn (with retries for transient failures) ---
      let attempt = 0;
      let response;
      for (;;) {
        try {
          response = await llm.continueConversation(
            { messages, responseSchema: ANSWER_SCHEMA, tools },
            signal,
          );
          break;
        } catch (err) {
          const retryable = err instanceof InvestigatorError && err.retryable;
          attempt += 1;
          if (!retryable || attempt > maxLlmRetries) throw err;
        }
      }

      await persistStep({
        input: { iteration: iterations },
        output: { content: response.content, toolCalls: response.toolCalls.map((t) => t.name) },
        reasoning: typeof response.content === "object" && response.content !== null
          ? JSON.stringify(response.content).slice(0, 2000)
          : String(response.content ?? "").slice(0, 2000),
        status: "OK",
      });

      if (response.toolCalls.length === 0) {
        answer = response.content;
        await finishRun("COMPLETED", { answer, iterations, toolCallsExecuted });
        return { status: "COMPLETED", answer, runId, iterations, toolCallsExecuted };
      }

      // --- Execute each requested tool sequentially, feed results back ---
      const assistantCalls = response.toolCalls.map((t) => ({ id: t.id, name: t.name, arguments: t.arguments }));
      messages.push({
        role: "assistant",
        content: typeof response.content === "string" ? response.content : null,
        toolCalls: assistantCalls,
      });

      for (const tc of response.toolCalls) {
        throwIfCancelled(signal);
        const result = await executeAgentTool(tc.name, tc.arguments, toolCtx);
        toolCallsExecuted += 1;

        await persistStep({
          toolName: tc.name,
          input: result.ok ? (tc.parsedArgs ?? {}) : { rawArguments: tc.arguments },
          output: result.ok
            ? (result as { data: unknown }).data
            : { code: (result as { code: string }).code, message: (result as { message: string }).message },
          reasoning: result.ok ? `tool ${tc.name} succeeded` : `tool ${tc.name} failed`,
          status: result.ok ? "OK" : "ERROR",
        });

        // Evidence row for every tool execution (success or failure).
        try {
          await db.incidentEvidence.create({
            data: {
              incidentId,
              findingId: null,
              toolName: tc.name,
              input: { args: tc.parsedArgs ?? tc.arguments } as never,
              output: (result ?? {}) as never,
              summary: `loop step ${seq}: ${tc.name} ${result.ok ? "ok" : "failed"}`,
            },
          });
        } catch {
          // Evidence must never break the loop.
        }

        messages.push({
          role: "tool",
          toolCallId: tc.id,
          name: tc.name,
          content: JSON.stringify(result).slice(0, 8000),
        });
      }
    }

    // Max iterations reached without a final answer.
    await finishRun("COMPLETED", { answer: null, iterations, toolCallsExecuted, stopped: "MAX_ITERATIONS" });
    return { status: "MAX_ITERATIONS", answer: null, runId, iterations, toolCallsExecuted };
  } catch (err) {
    if (signal?.aborted || (err instanceof InvestigatorError && err.message === "Investigation cancelled")) {
      await finishRun("CANCELLED", { iterations, toolCallsExecuted });
      return { status: "CANCELLED", answer: null, runId, iterations, toolCallsExecuted };
    }
    await persistStep({
      reasoning: err instanceof Error ? err.message : String(err),
      status: "ERROR",
    }).catch(() => undefined);
    await finishRun("FAILED", {
      error: err instanceof Error ? err.message : String(err),
      iterations,
      toolCallsExecuted,
    });
    return {
      status: "FAILED",
      answer: null,
      runId,
      iterations,
      toolCallsExecuted,
    };
  }
}
