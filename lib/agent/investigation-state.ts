// Investigator Agent State Model — persistent state of an investigation.
//
// Persistence strategy: reuse existing Prisma models without schema changes.
// - Investigation <-> FinancialIncident (+ AgentRun rows scoped by incidentId)
// - AgentRunState <-> AgentRun (status/input/output/startedAt/finishedAt)
// - AgentStepState <-> AgentStep (status/input/output/reasoning/seq)
// - ToolCallState <-> IncidentEvidence (toolName/input/output/summary)
// The helpers in this file serialize/deserialize the type-safe state into
// those rows' Json columns, so state can be paused (persisted) and resumed.

import { z } from "zod";

// ---------------------------------------------------------------- states

export const INVESTIGATION_STATES = [
  "DETECT",
  "UNDERSTAND",
  "PLAN",
  "INVESTIGATE",
  "VALIDATE",
  "QUANTIFY",
  "RECOMMEND",
  "APPROVAL",
  "EXECUTE",
  "VERIFY",
  "RESOLVE",
] as const;

export const investigationStateSchema = z.enum(INVESTIGATION_STATES);
export type InvestigationState = z.infer<typeof investigationStateSchema>;

// Linear pipeline with controlled non-linear edges (re-plan, re-validate,
// approval rejection loops back, failure can happen from anywhere).
const LINEAR_NEXT: Record<InvestigationState, InvestigationState | null> = {
  DETECT: "UNDERSTAND",
  UNDERSTAND: "PLAN",
  PLAN: "INVESTIGATE",
  INVESTIGATE: "VALIDATE",
  VALIDATE: "QUANTIFY",
  QUANTIFY: "RECOMMEND",
  RECOMMEND: "APPROVAL",
  APPROVAL: "EXECUTE",
  EXECUTE: "VERIFY",
  VERIFY: "RESOLVE",
  RESOLVE: null,
};

const EXTRA_EDGES: ReadonlyArray<readonly [InvestigationState, InvestigationState]> = [
  ["PLAN", "UNDERSTAND"], // re-plan after new understanding
  ["INVESTIGATE", "PLAN"], // investigation forces re-plan
  ["VALIDATE", "INVESTIGATE"], // validation fails -> investigate more
  ["APPROVAL", "RECOMMEND"], // approval rejected -> new recommendation
  ["APPROVAL", "PLAN"], // approval rejected -> re-plan
  ["VERIFY", "EXECUTE"], // verify fails -> re-execute
  ["EXECUTE", "PLAN"], // execution blocked -> re-plan
];

const ALLOWED_TRANSITIONS: ReadonlyMap<InvestigationState, ReadonlySet<InvestigationState>> =
  (() => {
    const m = new Map<InvestigationState, Set<InvestigationState>>();
    for (const s of INVESTIGATION_STATES) m.set(s, new Set());
    for (const [from, next] of Object.entries(LINEAR_NEXT)) {
      if (next) (m.get(from as InvestigationState) as Set<InvestigationState>).add(next as InvestigationState);
    }
    for (const [from, to] of EXTRA_EDGES) {
      (m.get(from) as Set<InvestigationState>).add(to);
    }
    return m;
  })();

export function canTransitionInvestigation(from: InvestigationState, to: InvestigationState): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertTransitionInvestigation(from: InvestigationState, to: InvestigationState): void {
  if (!canTransitionInvestigation(from, to)) {
    throw new Error(`Invalid investigation transition: ${from} -> ${to}`);
  }
}

// --- Agent run state (pause/resume + failure live here) ---

export const agentRunStateSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "PAUSED",
  "WAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type AgentRunState = z.infer<typeof agentRunStateSchema>;

const AGENT_RUN_TRANSITIONS: Record<AgentRunState, ReadonlyArray<AgentRunState>> = {
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "WAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED", "FAILED"],
  WAITING_APPROVAL: ["RUNNING", "CANCELLED", "FAILED"],
  COMPLETED: [],
  FAILED: ["QUEUED"], // retry re-queues
  CANCELLED: ["QUEUED"], // restart re-queues
};

export function canTransitionRun(from: AgentRunState, to: AgentRunState): boolean {
  return AGENT_RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalRunState(s: AgentRunState): boolean {
  return s === "COMPLETED" || s === "CANCELLED";
}

// Pause/resume helpers: pause only from RUNNING/WAITING_APPROVAL, resume to RUNNING.
export function pauseRun(s: AgentRunState): AgentRunState {
  if (s !== "RUNNING" && s !== "WAITING_APPROVAL") {
    throw new Error(`Cannot pause run in state ${s}`);
  }
  return "PAUSED";
}

export function resumeRun(s: AgentRunState): AgentRunState {
  if (s !== "PAUSED") throw new Error(`Cannot resume run in state ${s}`);
  return "RUNNING";
}

// --- Agent step state ---

export const agentStepStateSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "RETRYING",
]);
export type AgentStepState = z.infer<typeof agentStepStateSchema>;

const AGENT_STEP_TRANSITIONS: Record<AgentStepState, ReadonlyArray<AgentStepState>> = {
  PENDING: ["RUNNING", "SKIPPED"],
  RUNNING: ["SUCCEEDED", "FAILED", "SKIPPED"],
  SUCCEEDED: [],
  FAILED: ["RETRYING", "SKIPPED"],
  SKIPPED: [],
  RETRYING: ["RUNNING", "SKIPPED"],
};

export function canTransitionStep(from: AgentStepState, to: AgentStepState): boolean {
  return AGENT_STEP_TRANSITIONS[from]?.includes(to) ?? false;
}

// --- Tool call state ---

export const toolCallStateSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
]);
export type ToolCallState = z.infer<typeof toolCallStateSchema>;

export const toolCallSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  input: z.record(z.unknown()).default({}),
  output: z.unknown().optional(),
  state: toolCallStateSchema.default("PENDING"),
  attempt: z.number().int().min(1).default(1),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

// --- Failure ---

export const failureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  phase: investigationStateSchema,
  retryable: z.boolean().default(true),
  occurredAt: z.string().default(() => new Date().toISOString()),
});
export type InvestigationFailure = z.infer<typeof failureSchema>;

// --- Investigation context (persisted snapshot) ---

export const investigationContextSchema = z.object({
  investigationId: z.string().min(1),
  orgId: z.string().min(1),
  incidentId: z.string().min(1),
  phase: investigationStateSchema.default("DETECT"),
  runState: agentRunStateSchema.default("QUEUED"),
  hypotheses: z
    .array(
      z.object({
        id: z.string().min(1),
        statement: z.string().min(1),
        status: z.enum(["OPEN", "SUPPORTED", "REJECTED"]),
        confidence: z.number().min(0).max(1),
      }),
    )
    .default([]),
  findings: z.array(z.string()).default([]),
  toolCalls: z.array(toolCallSchema).default([]),
  failure: failureSchema.nullable().default(null),
  pausedAt: z.string().nullable().default(null),
  updatedAt: z.string().default(() => new Date().toISOString()),
  version: z.number().int().min(1).default(1),
});
export type InvestigationContext = z.infer<typeof investigationContextSchema>;

// ---------------------------------------------------------------- operations

export function createInvestigation(input: {
  investigationId: string;
  orgId: string;
  incidentId: string;
}): InvestigationContext {
  return investigationContextSchema.parse({
    investigationId: input.investigationId,
    orgId: input.orgId,
    incidentId: input.incidentId,
    phase: "DETECT",
    runState: "QUEUED",
  });
}

export function advancePhase(ctx: InvestigationContext, to: InvestigationState): InvestigationContext {
  assertTransitionInvestigation(ctx.phase, to);
  return investigationContextSchema.parse({ ...ctx, phase: to, updatedAt: new Date().toISOString(), version: ctx.version + 1 });
}

export function pauseInvestigation(ctx: InvestigationContext): InvestigationContext {
  const runState = pauseRun(ctx.runState);
  const now = new Date().toISOString();
  return investigationContextSchema.parse({ ...ctx, runState, pausedAt: now, updatedAt: now, version: ctx.version + 1 });
}

export function resumeInvestigation(ctx: InvestigationContext): InvestigationContext {
  const runState = resumeRun(ctx.runState);
  return investigationContextSchema.parse({
    ...ctx,
    runState,
    pausedAt: null,
    updatedAt: new Date().toISOString(),
    version: ctx.version + 1,
  });
}

export function failInvestigation(
  ctx: InvestigationContext,
  failure: Omit<InvestigationFailure, "occurredAt"> & { occurredAt?: string },
): InvestigationContext {
  const parsed = failureSchema.parse({ ...failure, phase: failure.phase ?? ctx.phase });
  return investigationContextSchema.parse({
    ...ctx,
    runState: "FAILED",
    failure: parsed,
    updatedAt: new Date().toISOString(),
    version: ctx.version + 1,
  });
}

// ---------------------------------------------------------------- persistence (Prisma reuse)

export type PrismaAgentRunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type PrismaAgentStepStatus = "PENDING" | "RUNNING" | "OK" | "ERROR";

/** Map run state -> existing Prisma AgentRunStatus. PAUSED/WAITING_APPROVAL/QUEUED persist as RUNNING with detail in Json. */
export function toPrismaRunStatus(s: AgentRunState): PrismaAgentRunStatus {
  switch (s) {
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "RUNNING";
  }
}

export function fromPrismaRunStatus(
  status: PrismaAgentRunStatus,
  snapshot?: { runState?: unknown },
): AgentRunState {
  if (snapshot?.runState) {
    const parsed = agentRunStateSchema.safeParse(snapshot.runState);
    if (parsed.success) return parsed.data;
  }
  switch (status) {
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "RUNNING";
  }
}

export function toPrismaStepStatus(s: AgentStepState): PrismaAgentStepStatus {
  switch (s) {
    case "SUCCEEDED":
      return "OK";
    case "FAILED":
      return "ERROR";
    default:
      return s === "RUNNING" ? "RUNNING" : "PENDING";
  }
}

/** Serialize context for storage in AgentRun.input/output Json columns. */
export function serializeContext(ctx: InvestigationContext): Record<string, unknown> {
  return JSON.parse(JSON.stringify(ctx)) as Record<string, unknown>;
}

/** Deserialize + validate a persisted snapshot (throws on invalid data). */
export function deserializeContext(raw: unknown): InvestigationContext {
  return investigationContextSchema.parse(raw);
}

/** JSON round-trip check used to guarantee persistability. */
export function roundTripContext(ctx: InvestigationContext): InvestigationContext {
  return deserializeContext(JSON.parse(JSON.stringify(serializeContext(ctx))));
}
