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
import { z } from "zod";
import {
  InvestigatorError,
  type InvestigatorClient,
  type LlmMessage,
} from "../ai/investigator-client";
import { executeAgentTool, getOpenAITools } from "../tools/openai";
import type { ToolContext } from "../tools/types";

export const INVESTIGATOR_SYSTEM_PROMPT =
  "You are a CFO investigation assistant. You decide the investigation path yourself: " +
  "no step order is prescribed. Each turn, study ALL prior tool results, update your " +
  "understanding of known facts vs unknowns, then either call the single most informative " +
  "next tool or — only when the evidence truly answers the question — set done:true and " +
  "give the final summary. Never call a tool you have already called with the same arguments. " +
  "Never invent numbers — every figure must come from a tool result.";

// Phase 0 (UNDERSTAND -> PLAN): the agent must first frame the investigation
// before touching any tool. Nothing here hardcodes a tool sequence.
export const investigationPlanSchema = z.object({
  objective: z.string().min(1),
  period: z.string().min(1),
  metric: z.string().min(1),
  knownFacts: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  initialPlan: z.array(z.string()).min(1),
});
export type InvestigationPlan = z.infer<typeof investigationPlanSchema>;

const PLAN_SCHEMA = {
  name: "investigation_plan",
  schema: {
    type: "object",
    properties: {
      objective: { type: "string" },
      period: { type: "string" },
      metric: { type: "string" },
      knownFacts: { type: "array", items: { type: "string" } },
      unknowns: { type: "array", items: { type: "string" } },
      initialPlan: { type: "array", items: { type: "string" } },
    },
    required: ["objective", "period", "metric", "initialPlan"],
    additionalProperties: false,
  },
};

// Per-turn deliberation: the agent reasons about results and decides the
// next move itself. done:true with zero tool calls is the ONLY finish signal.
const DELIBERATION_SCHEMA = {
  name: "investigation_deliberation",
  schema: {
    type: "object",
    properties: {
      thinking: { type: "string" },
      learned: { type: "array", items: { type: "string" } },
      nextFocus: { type: "string" },
      done: { type: "boolean" },
      summary: { type: "string" },
    },
    required: ["thinking", "done"],
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
  plan: InvestigationPlan | null;
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
  let plan: InvestigationPlan | null = null;

  const callLlm = async (
    schema: typeof PLAN_SCHEMA | typeof DELIBERATION_SCHEMA,
    useTools: boolean,
  ) => {
    let attempt = 0;
    for (;;) {
      try {
        return await llm.continueConversation(
          { messages, responseSchema: schema, ...(useTools ? { tools } : {}) },
          signal,
        );
      } catch (err) {
        const retryable = err instanceof InvestigatorError && err.retryable;
        attempt += 1;
        if (!retryable || attempt > maxLlmRetries) throw err;
      }
    }
  };

  try {
    // --- Phase 0: UNDERSTAND -> PLAN (no tools; frame before acting) ---
    throwIfCancelled(signal);
    const planResponse = await callLlm(PLAN_SCHEMA, false);
    const parsedPlan = investigationPlanSchema.safeParse(planResponse.content);
    plan = parsedPlan.success
      ? parsedPlan.data
      : {
          objective: question,
          period: "unknown",
          metric: "unknown",
          knownFacts: [],
          unknowns: ["plan was malformed; proceeding from the raw question"],
          initialPlan: ["gather baseline figures, then follow the evidence"],
        };
    await persistStep({
      input: { phase: "PLAN" },
      output: plan,
      reasoning: `plan: ${plan.objective} | unknowns: ${plan.unknowns.join("; ")}`,
      status: parsedPlan.success ? "OK" : "ERROR",
    });
    messages.push({
      role: "user",
      content:
        `Agreed investigation plan: ${JSON.stringify(plan)}. ` +
        `Follow it loosely — adapt whenever tool results surprise you. ` +
        `Now investigate, choosing each next tool yourself based on results.`,
    });

    while (iterations < maxIterations) {
      throwIfCancelled(signal);
      iterations += 1;

      // --- Dynamic deliberation turn: the agent picks its own next move ---
      const response = await callLlm(DELIBERATION_SCHEMA, true);

      await persistStep({
        input: { iteration: iterations },
        output: { content: response.content, toolCalls: response.toolCalls.map((t) => t.name) },
        reasoning: typeof response.content === "object" && response.content !== null
          ? JSON.stringify(response.content).slice(0, 2000)
          : String(response.content ?? "").slice(0, 2000),
        status: "OK",
      });

      const deliberation = (response.content ?? {}) as { done?: unknown };
      if (response.toolCalls.length === 0) {
        // The ONLY finish signal: no further tool needed AND done:true.
        if (deliberation.done === true) {
          answer = response.content;
          await finishRun("COMPLETED", { answer, plan, iterations, toolCallsExecuted });
          return { status: "COMPLETED", answer, plan, runId, iterations, toolCallsExecuted };
        }
        // Premature stop — nudge the agent to choose a tool or finish honestly.
        messages.push({
          role: "user",
          content:
            "You requested no tool but did not set done:true. Either call the next most " +
            "informative tool, or set done:true with your final summary.",
        });
        continue;
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
    await finishRun("COMPLETED", { answer: null, plan, iterations, toolCallsExecuted, stopped: "MAX_ITERATIONS" });
    return { status: "MAX_ITERATIONS", answer: null, plan, runId, iterations, toolCallsExecuted };
  } catch (err) {
    if (signal?.aborted || (err instanceof InvestigatorError && err.message === "Investigation cancelled")) {
      await finishRun("CANCELLED", { plan, iterations, toolCallsExecuted });
      return { status: "CANCELLED", answer: null, plan, runId, iterations, toolCallsExecuted };
    }
    await persistStep({
      reasoning: err instanceof Error ? err.message : String(err),
      status: "ERROR",
    }).catch(() => undefined);
    await finishRun("FAILED", {
      error: err instanceof Error ? err.message : String(err),
      plan,
      iterations,
      toolCallsExecuted,
    });
    return {
      status: "FAILED",
      answer: null,
      plan,
      runId,
      iterations,
      toolCallsExecuted,
    };
  }
}
