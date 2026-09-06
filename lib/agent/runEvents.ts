// Run event stream — deterministic projection of a persisted investigation
// into Server-Sent Events (spec §40).
//
// The SSE route replays these events from AgentRun/AgentStep/IncidentEvidence
// rows: same rows → same event list (stable numeric ids, so follow-polling can
// resume from `id > lastSeen`). No LLM, no tool execution, no Prisma here —
// the route loads rows and calls buildRunEvents().
//
// Event vocabulary (spec §40, plus a terminal `agent_finished`):
//   agent_started, agent_step, tool_started, tool_completed, evidence_added,
//   finding_created is intentionally absent: findings mirror hypotheses inside
//   the loop and are readable via GET incidents/[id] — wiring them here would
//   duplicate that surface. approval_required/action_executed/
//   verification_completed belong to the action loop (B4), not the read-only
//   investigator.

import type { LoopStatus } from "./investigator-loop";

export type StreamEventType =
  | "agent_started"
  | "agent_step"
  | "tool_started"
  | "tool_completed"
  | "evidence_added"
  | "agent_finished"
  | "stream_error";

export interface StreamEvent {
  id: number;
  type: StreamEventType;
  data: Record<string, unknown>;
}

export interface RunRow {
  id: string;
  incidentId: string | null;
  status: string;
  input: unknown;
  output: unknown;
  modelName: string | null;
  startedAt: Date | string;
}

export interface StepRow {
  seq: number;
  toolName: string | null;
  status: string;
  reasoning: string | null;
  startedAt: Date | string;
}

export interface EvidenceRow {
  id: string;
  toolName: string;
  summary: string;
  occurredAt: Date | string;
  sourceType?: string | null;
  sourceId?: string | null;
}

/** COMPLETED rows that stopped early (output.stopped) surface as MAX_ITERATIONS. */
export function toLoopStatus(status: string, output: unknown): LoopStatus {
  if (status === "COMPLETED") {
    const stopped = (output as { stopped?: unknown } | null)?.stopped;
    return stopped === "MAX_ITERATIONS" ? "MAX_ITERATIONS" : "COMPLETED";
  }
  if (status === "FAILED") return "FAILED";
  if (status === "CANCELLED") return "CANCELLED";
  return "FAILED"; // RUNNING has no loop outcome yet; callers check terminal first
}

export function isTerminalRunStatus(status: string): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * Project a run snapshot into an ordered, id-stable event list:
 * agent_started → per-step agent_step (+ tool_started/tool_completed when the
 * step names a tool) → evidence_added (incident evidence at/after run start,
 * by occurredAt) → agent_finished (terminal runs only).
 */
export function buildRunEvents(args: {
  run: RunRow;
  steps: StepRow[];
  evidence: EvidenceRow[];
}): StreamEvent[] {
  const { run } = args;
  const events: StreamEvent[] = [];
  let id = 0;
  const push = (type: StreamEventType, data: Record<string, unknown>) => {
    id += 1;
    events.push({ id, type, data });
  };

  const input = asRecord(run.input);
  push("agent_started", {
    runId: run.id,
    incidentId: run.incidentId,
    question: typeof input.question === "string" ? input.question : null,
    modelName: run.modelName,
    startedAt: iso(run.startedAt),
  });

  const orderedSteps = [...args.steps].sort((a, b) => a.seq - b.seq);
  for (const s of orderedSteps) {
    push("agent_step", {
      seq: s.seq,
      toolName: s.toolName,
      status: s.status,
      reasoning: typeof s.reasoning === "string" ? s.reasoning.slice(0, 2000) : null,
      startedAt: iso(s.startedAt),
    });
    if (s.toolName) {
      if (s.status === "PENDING" || s.status === "RUNNING") {
        push("tool_started", { seq: s.seq, toolName: s.toolName });
      } else if (s.status === "OK" || s.status === "ERROR") {
        push("tool_completed", { seq: s.seq, toolName: s.toolName, ok: s.status === "OK" });
      }
    }
  }

  const runStart = new Date(run.startedAt).getTime();
  const orderedEvidence = [...args.evidence]
    .filter((e) => new Date(e.occurredAt).getTime() >= runStart)
    .sort((a, b) => {
      const dt = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
      return dt !== 0 ? dt : a.id < b.id ? -1 : 1;
    });
  for (const e of orderedEvidence) {
    push("evidence_added", {
      id: e.id,
      toolName: e.toolName,
      summary: e.summary,
      occurredAt: iso(e.occurredAt),
      ...(e.sourceType ? { sourceType: e.sourceType } : {}),
      ...(e.sourceId ? { sourceId: e.sourceId } : {}),
    });
  }

  if (isTerminalRunStatus(run.status)) {
    const output = asRecord(run.output);
    push("agent_finished", {
      status: toLoopStatus(run.status, run.output),
      answer: output.answer ?? null,
      iterations: typeof output.iterations === "number" ? output.iterations : 0,
      toolCallsExecuted:
        typeof output.toolCallsExecuted === "number" ? output.toolCallsExecuted : 0,
    });
  }

  return events;
}

/** Serialize one event to SSE wire format (`id/event/data` + blank line). */
export function formatSseEvent(e: StreamEvent): string {
  return `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`;
}
