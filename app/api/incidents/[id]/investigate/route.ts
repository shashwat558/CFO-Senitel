// POST /api/incidents/[id]/investigate — run the Investigator Agent loop for
// an incident, synchronously, and report the persistent run.
//
//   getSession → (org-scoped incident check) → idempotent replay → concurrency guard
//                 → runInvestigatorLoop
//
// Semantics:
//   - Concurrency guard: only one RUNNING investigation per incident. A second
//     POST while one is in flight gets 409 CONFLICT.
//   - Idempotency-Key header: a unique per-org token. Re-sending the same key
//     replays the persisted run (same status/runId, no new loop). Reusing a key
//     for a different incident is a 409, not a replay. A same-key race against
//     the DB unique constraint (orgId, idempotencyKey) also surfaces as 409.
//   - Distinct outcome codes: COMPLETED / MAX_ITERATIONS → 200, FAILED → 500,
//     CANCELLED → 499. The AgentRun row records the full outcome
//     (output/answer/iterations) for GET /runs and /runs/[runId]/steps consumers.
//   - Cost caps pass through: maxIterations (default 8) and maxLlmRetries
//     (default 2); the loop slices every tool result to 8k chars before
//     re-feeding it to the LLM.
//   - The combined AbortSignal aborts on the whole-loop timeout OR the client
//     disconnecting; abort lands the run in CANCELLED status.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createInvestigatorClient } from "@/lib/ai/investigator-client";
import { runInvestigatorLoop, type LoopStatus } from "@/lib/agent/investigator-loop";
import { getIncident } from "@/lib/services/incidents";
import { getSession } from "@/lib/auth/session";
import { ConflictError, toStatus, ValidationError } from "@/lib/services/errors";
import { investigateIncidentSchema } from "@/lib/validation/investigate";

export const dynamic = "force-dynamic";
// A full investigation spans many LLM turns + tool calls; allow long-running
// route handlers on platforms that enforce a limit.
export const maxDuration = 300;

/** Overall loop budget; default 10 minutes, env-overridable. */
function loopTimeoutMs(): number {
  const raw = process.env.INVESTIGATOR_LOOP_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 10 * 60 * 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 10 * 60 * 1000;
}

const LOOP_STATUS_HTTP: Record<LoopStatus, number> = {
  COMPLETED: 200,
  MAX_ITERATIONS: 200,
  FAILED: 500,
  CANCELLED: 499,
};

/** Persisted AgentRunStatus → LoopStatus. COMPLETED rows that stopped early
 *  because the agent exhausted maxIterations surface as MAX_ITERATIONS. */
function persistedToLoopStatus(run: { status: string; output: unknown }): LoopStatus {
  if (run.status === "COMPLETED") {
    const stopped = (run.output as { stopped?: unknown } | null)?.stopped;
    return stopped === "MAX_ITERATIONS" ? "MAX_ITERATIONS" : "COMPLETED";
  }
  if (run.status === "FAILED") return "FAILED";
  if (run.status === "CANCELLED") return "CANCELLED";
  return "FAILED"; // RUNNING is handled by the caller before this is reached
}

/** Prisma P2002 = unique constraint violation (AgentRun orgId+idempotencyKey
 *  among others) — used to resolve the same-key create race as a 409. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), loopTimeoutMs());
  // Abort the loop when the whole-run budget expires OR the client disconnects.
  const signal = AbortSignal.any([controller.signal, req.signal]);
  try {
    // Tenant + actor come from the session: investigate inside session.user.orgId.
    const session = await getSession(prisma);
    const orgId = session.user.orgId;
    const actorId = session.user.id;
    // Org isolation: the incident must belong to this org (404 otherwise).
    await getIncident(prisma, orgId, params.id);

    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = investigateIncidentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(`invalid investigation request: ${parsed.error.message}`);
    }
    const { question, maxIterations, maxLlmRetries } = parsed.data;
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() || undefined;

    // Idempotent replay: an existing run for this key is returned as-is — the
    // loop is NOT re-run. Reusing a key for a different incident is a conflict.
    if (idempotencyKey) {
      const prior = await prisma.agentRun.findFirst({
        where: { orgId, idempotencyKey },
      });
      if (prior) {
        if (prior.incidentId !== params.id) {
          throw new ConflictError("idempotency key was already used for a different incident");
        }
        if (prior.status === "RUNNING") {
          throw new ConflictError("an investigation with this idempotency key is already running");
        }
        const status = persistedToLoopStatus(prior);
        return NextResponse.json(
          { status, runId: prior.id },
          { status: LOOP_STATUS_HTTP[status] }
        );
      }
    }

    // Concurrency guard: only one RUNNING investigation per incident.
    const running = await prisma.agentRun.count({
      where: { orgId, incidentId: params.id, status: "RUNNING" },
    });
    if (running > 0) {
      throw new ConflictError("an investigation for this incident is already running");
    }

    let result;
    try {
      result = await runInvestigatorLoop({
        db: prisma,
        llm: createInvestigatorClient(),
        toolCtx: { db: prisma, orgId, actorId },
        orgId,
        incidentId: params.id,
        question,
        maxIterations,
        maxLlmRetries,
        idempotencyKey,
        actorId,
        signal,
      });
    } catch (e) {
      // Two simultaneous POSTs with the same key: the DB unique constraint is
      // the backstop — surface it as a 409 instead of a generic 500.
      if (isUniqueViolation(e)) {
        throw new ConflictError("an investigation with this idempotency key is already running");
      }
      throw e;
    }

    // Distinct outcome codes: 200 (COMPLETED / budget-exhausted MAX_ITERATIONS),
    // 500 (FAILED), 499 (CANCELLED by timeout or client disconnect). The
    // AgentRun row records the full detail for /runs consumers.
    return NextResponse.json(
      { status: result.status, runId: result.runId },
      { status: LOOP_STATUS_HTTP[result.status] }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "investigation failed" },
      { status: toStatus(e, 500) }
    );
  } finally {
    clearTimeout(timer);
  }
}