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
import {
  addContradictoryEvidence,
  addSupportingEvidence,
  createHypothesis,
  hypothesisStatusSchema,
  setConfidence,
  setHypothesisStatus,
  type Hypothesis,
} from "./hypotheses";
import {
  createFinding,
  linkAgentStep,
  recordFinding,
  updateFindingRow,
  type Finding,
} from "./findings";

export const INVESTIGATOR_SYSTEM_PROMPT =
  "You are a CFO investigation assistant. You decide the investigation path yourself: " +
  "no step order is prescribed. Each turn, study ALL prior tool results, update your " +
  "understanding of known facts vs unknowns, then either call the single most informative " +
  "next tool or — only when the evidence truly answers the question — set done:true and " +
  "give the final summary. Never call a tool you have already called with the same arguments. " +
  "Work hypothesis-first: keep 1-2 live hypotheses (e.g. 'COGS increase caused margin decline'), " +
  "report every turn their status (PROPOSED/INVESTIGATING/SUPPORTED/REJECTED) with confidence " +
  "0-1 plus supporting/contradicting notes, and abandon (REJECTED) any hypothesis the evidence " +
  "contradicts in favor of a better explanation. " +
  "Call only tools listed in this conversation — inventing a tool name rejects your turn. " +
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
    // NOTE (Groq strict mode): `required` must list every key in
    // `properties`, or the provider 400s the structured request.
    required: ["objective", "period", "metric", "knownFacts", "unknowns", "initialPlan"],
    additionalProperties: false,
  },
};

// Per-turn deliberation: the agent reasons about results, maintains its
// hypotheses, and decides the next move itself. done:true with zero tool
// calls is the ONLY finish signal.
const HYPOTHESIS_UPDATE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    statement: { type: "string" },
    status: { type: "string", enum: ["PROPOSED", "INVESTIGATING", "SUPPORTED", "REJECTED"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    supporting: { type: "array", items: { type: "string" } },
    contradicting: { type: "array", items: { type: "string" } },
  },
  required: ["id", "statement", "status", "confidence", "supporting", "contradicting"],
  additionalProperties: false,
};

const DELIBERATION_SCHEMA = {
  name: "investigation_deliberation",
  schema: {
    type: "object",
    properties: {
      thinking: { type: "string" },
      learned: { type: "array", items: { type: "string" } },
      nextFocus: { type: "string" },
      hypotheses: { type: "array", items: HYPOTHESIS_UPDATE_SCHEMA },
      done: { type: "boolean" },
      summary: { type: "string" },
    },
    required: ["thinking", "learned", "nextFocus", "hypotheses", "done", "summary"],
    additionalProperties: false,
  },
};

const hypothesisUpdateSchema = z.object({
  id: z.string().min(1).optional(),
  statement: z.string().min(3).max(2000).optional(),
  status: hypothesisStatusSchema,
  confidence: z.number().min(0).max(1).optional(),
  supporting: z.array(z.string()).default([]),
  contradicting: z.array(z.string()).default([]),
});

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
  /** Client-supplied idempotency token, persisted on the AgentRun row. */
  idempotencyKey?: string;
  actorId?: string;
  signal?: AbortSignal;
  onStep?: (step: { seq: number; kind: string; detail: string }) => void;
}

export type LoopStatus = "COMPLETED" | "MAX_ITERATIONS" | "FAILED" | "CANCELLED";

export interface LoopResult {
  status: LoopStatus;
  answer: unknown;
  plan: InvestigationPlan | null;
  hypotheses: Hypothesis[];
  findings: Finding[];
  runId: string;
  iterations: number;
  toolCallsExecuted: number;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new InvestigatorError("TIMEOUT", "Investigation cancelled", false);
  }
}

/**
 * Grounding block for the first user message: the model cannot guess the
 * tenant id or the data window, and guessing either wastes turns on
 * ORG_MISMATCH / empty-range failures (observed live on Groq). Everything
 * here comes from the database; if a lookup fails (e.g. minimal test
 * doubles), that line is skipped rather than fabricated.
 */
async function buildToolContextBlock(
  db: PrismaClient,
  orgId: string,
  incidentId: string
): Promise<string> {
  const lines = [
    `Context for tool calls: your orgId is "${orgId}" — pass it verbatim as the orgId argument to every tool. Never invent a different orgId.`,
  ];
  try {
    const incident = await db.financialIncident.findFirst({
      where: { id: incidentId, orgId },
      select: { title: true, periodStart: true, periodEnd: true },
    });
    if (incident?.periodStart && incident?.periodEnd) {
      const s = new Date(incident.periodStart).toISOString().slice(0, 10);
      const e = new Date(incident.periodEnd).toISOString().slice(0, 10);
      lines.push(
        `You are investigating "${incident.title}", covering ${s} to ${e}. Start with P&L for those months (year + month, or startDate + endDate).`
      );
    }
  } catch {
    // Context is best-effort; the loop must run without it.
  }
  try {
    const bounds = await db.transaction.aggregate({
      where: { orgId },
      _min: { date: true },
      _max: { date: true },
    });
    const min = bounds._min.date;
    const max = bounds._max.date;
    if (min && max) {
      lines.push(
        `Posted financial data spans ${new Date(min).toISOString().slice(0, 10)} to ${new Date(max).toISOString().slice(0, 10)}. Query inside that window.`
      );
    }
  } catch {
    // Context is best-effort; the loop must run without it.
  }
  return lines.join("\n");
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
    idempotencyKey,
    signal,
  } = opts;

  const run = await db.agentRun.create({
    data: {
      orgId,
      incidentId,
      idempotencyKey: idempotencyKey ?? null,
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
  }): Promise<number> => {
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
    return seq;
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
    { role: "user", content: `${question}\n\n${await buildToolContextBlock(db, orgId, incidentId)}` },
  ];
  const tools = getOpenAITools();

  let iterations = 0;
  let toolCallsExecuted = 0;
  let answer: unknown = null;
  let plan: InvestigationPlan | null = null;

  // Live hypothesis registry + mirrored findings + IncidentFinding row ids.
  let hypotheses: Hypothesis[] = [];
  let findings: Finding[] = [];
  const findingIds = new Map<string, string>();

  const persistHypothesis = async (h: Hypothesis, agentStepSeq: number | null = null) => {
    try {
      const rank = Math.max(0, hypotheses.findIndex((x) => x.id === h.id));
      const statusMap = {
        PROPOSED: "HYPOTHESIS",
        INVESTIGATING: "INVESTIGATING",
        SUPPORTED: "SUPPORTED",
        REJECTED: "REJECTED",
      } as const;
      let f = findings.find((x) => x.id === h.id);
      if (!f) {
        f = createFinding({
          incidentId,
          statement: h.statement,
          id: h.id,
          type: "HYPOTHESIS",
          status: statusMap[h.status],
          confidence: h.confidence,
        });
        findings.push(f);
      } else {
        f = { ...f, statement: h.statement, status: statusMap[h.status], confidence: h.confidence };
        findings = findings.map((x) => (x.id === f!.id ? f! : x));
      }
      if (agentStepSeq !== null) f = linkAgentStep(f, `step_${agentStepSeq}`);
      findings = findings.map((x) => (x.id === (f as Finding).id ? (f as Finding) : x));
      const existing = findingIds.get(h.id);
      if (existing) {
        await updateFindingRow(db, existing, f, rank);
      } else {
        const rowId = await recordFinding(db, f, rank);
        findingIds.set(h.id, rowId);
      }
    } catch {
      // Hypothesis/finding persistence must never break the loop.
    }
  };

  /** Fold the agent's declared hypothesis updates into the registry. */
  const applyHypothesisUpdates = async (raw: unknown): Promise<void> => {
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      const parsed = hypothesisUpdateSchema.safeParse(item);
      if (!parsed.success) continue;
      const u = parsed.data;
      let h = hypotheses.find((x) => (u.id && x.id === u.id) || (u.statement && x.statement === u.statement));
      if (!h) {
        if (!u.statement) continue; // cannot create without a statement
        h = createHypothesis({ id: u.id, statement: u.statement, confidence: u.confidence });
        hypotheses.push(h);
        await persistHypothesis(h);
      }
      // Walk toward the target status one valid edge at a time so every
      // persisted state respects the lifecycle (e.g. PROPOSED -> SUPPORTED
      // passes through INVESTIGATING).
      try {
        let guard = 0;
        while (h.status !== u.status && guard < 4) {
          guard += 1;
          const next: Hypothesis["status"] =
            h.status === "PROPOSED"
              ? u.status === "REJECTED" ? "REJECTED" : "INVESTIGATING"
              : h.status === "REJECTED"
                ? "INVESTIGATING"
                : u.status;
          h = setHypothesisStatus(h, next);
        }
        if (h.status !== u.status) continue;
      } catch {
        continue; // invalid transition — ignore this update, keep old state
      }
      for (const note of u.supporting) h = addSupportingEvidence(h, note);
      for (const note of u.contradicting) h = addContradictoryEvidence(h, note);
      if (u.confidence !== undefined) h = setConfidence(h, u.confidence);
      const finalH = h;
      hypotheses = hypotheses.map((x) => (x.id === finalH.id ? finalH : x));
      const stepSeq = await persistStep({
        input: { hypothesisId: finalH.id },
        output: finalH,
        reasoning: `hypothesis ${finalH.id} -> ${finalH.status} (confidence ${finalH.confidence}): ${finalH.statement}`,
        status: "OK",
      });
      await persistHypothesis(finalH, stepSeq);
    }
  };

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
      // A rejected turn (e.g. the model invented a tool name and the provider
      // refused it) is correctable feedback, not run death: nudge and continue.
      // The iteration budget still bounds the loop.
      let response;
      try {
        response = await callLlm(DELIBERATION_SCHEMA, true);
      } catch (err) {
        const badTool =
          err instanceof InvestigatorError &&
          err.code === "BAD_REQUEST" &&
          /tool/i.test(err.message);
        if (!badTool) throw err;
        await persistStep({
          input: { iteration: iterations },
          reasoning: `rejected turn (invalid tool call): ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000),
          status: "ERROR",
        });
        messages.push({
          role: "user",
          content:
            "Your last turn was rejected because it named a tool that does not exist. " +
            "Use ONLY the tools provided in this conversation — never invent tool names. " +
            "Either call a listed tool with valid arguments, or set done:true with your final summary.",
        });
        continue;
      }

      await persistStep({
        input: { iteration: iterations },
        output: { content: response.content, toolCalls: response.toolCalls.map((t) => t.name) },
        reasoning: typeof response.content === "object" && response.content !== null
          ? JSON.stringify(response.content).slice(0, 2000)
          : String(response.content ?? "").slice(0, 2000),
        status: "OK",
      });

      const deliberation = (response.content ?? {}) as { done?: unknown; hypotheses?: unknown };
      await applyHypothesisUpdates(deliberation.hypotheses);
      if (response.toolCalls.length === 0) {
        // The ONLY finish signal: no further tool needed AND done:true.
        if (deliberation.done === true) {
          answer = response.content;
          await finishRun("COMPLETED", { answer, plan, hypotheses, findings, iterations, toolCallsExecuted });
          return { status: "COMPLETED", answer, plan, hypotheses, findings, runId, iterations, toolCallsExecuted };
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

        // Evidence row for every tool execution (success or failure),
        // linked to the active hypothesis when there is one.
        const active = [...hypotheses].reverse().find((x) => x.status === "INVESTIGATING")
          ?? [...hypotheses].reverse().find((x) => x.status === "PROPOSED");
        const findingId = active ? (findingIds.get(active.id) ?? null) : null;
        try {
          await db.incidentEvidence.create({
            data: {
              incidentId,
              findingId,
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
    await finishRun("COMPLETED", { answer: null, plan, hypotheses, findings, iterations, toolCallsExecuted, stopped: "MAX_ITERATIONS" });
    return { status: "MAX_ITERATIONS", answer: null, plan, hypotheses, findings, runId, iterations, toolCallsExecuted };
  } catch (err) {
    if (signal?.aborted || (err instanceof InvestigatorError && err.message === "Investigation cancelled")) {
      await finishRun("CANCELLED", { plan, hypotheses, findings, iterations, toolCallsExecuted });
      return { status: "CANCELLED", answer: null, plan, hypotheses, findings, runId, iterations, toolCallsExecuted };
    }
    await persistStep({
      reasoning: err instanceof Error ? err.message : String(err),
      status: "ERROR",
    }).catch(() => undefined);
    await finishRun("FAILED", {
      error: err instanceof Error ? err.message : String(err),
      plan,
      hypotheses,
      findings,
      iterations,
      toolCallsExecuted,
    });
    return {
      status: "FAILED",
      answer: null,
      plan,
      hypotheses,
      findings,
      runId,
      iterations,
      toolCallsExecuted,
    };
  }
}
