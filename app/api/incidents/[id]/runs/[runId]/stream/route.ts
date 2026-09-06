// GET /api/incidents/[id]/runs/[runId]/stream — Server-Sent Events replay of
// one investigation run (spec §40: agent_started, agent_step, tool_started,
// tool_completed, evidence_added, … + terminal agent_finished).
//
// Semantics:
//   - Org-scoped: incident and run must both belong to the session org (404).
//   - Events are rebuilt from persisted AgentRun/AgentStep/IncidentEvidence
//     rows via buildRunEvents(), so the stream is a deterministic replay —
//     same rows → same ids. `?cursor=<lastId>` resumes after a reconnect.
//   - `?follow=1` (default) keeps the stream open while the run is RUNNING,
//     polling the DB and emitting only new ids, with `: ping` heartbeats.
//     `?follow=0` sends one snapshot and closes. Poll/wait budgets are
//     clamped (`pollMs` 250..5000, `maxWaitMs` ≤ 600000) so a forgotten tab
//     cannot hold the handler forever.
//   - Evidence linkage is approximate: IncidentEvidence rows carry no runId,
//     so rows for this incident at/after run start are attributed to the run.

import { prisma } from "@/lib/db/prisma";
import { getIncident } from "@/lib/services/incidents";
import { getSession } from "@/lib/auth/session";
import { NotFoundError, toStatus, ValidationError } from "@/lib/services/errors";
import {
  buildRunEvents,
  formatSseEvent,
  isTerminalRunStatus,
  type EvidenceRow,
  type RunRow,
  type StepRow,
  type StreamEvent,
} from "@/lib/agent/runEvents";

export const dynamic = "force-dynamic";

const DEFAULT_POLL_MS = 1000;
const HEARTBEAT_MS = 15000;
const DEFAULT_MAX_WAIT_MS = 600000;

function numParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

async function loadSnapshot(runId: string, incidentId: string) {
  const [steps, evidence] = await Promise.all([
    prisma.agentStep.findMany({ where: { runId }, orderBy: { seq: "asc" } }),
    prisma.incidentEvidence.findMany({
      where: { incidentId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 500,
    }),
  ]);
  return {
    steps: steps as unknown as StepRow[],
    evidence: evidence as unknown as EvidenceRow[],
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function GET(req: Request, { params }: { params: { id: string; runId: string } }) {
  try {
    const session = await getSession(prisma);
    const orgId = session.user.orgId;
    if (!params.runId) throw new ValidationError("run id is required");
    await getIncident(prisma, orgId, params.id);
    const runRow = await prisma.agentRun.findFirst({
      where: { id: params.runId, orgId, incidentId: params.id },
    });
    if (!runRow) throw new NotFoundError("agent run not found");

    const url = new URL(req.url);
    const followParam = url.searchParams.get("follow");
    const follow = followParam !== "0" && followParam?.toLowerCase() !== "false";
    const cursor = numParam(url, "cursor", 0, 0, Number.MAX_SAFE_INTEGER);
    const pollMs = numParam(url, "pollMs", DEFAULT_POLL_MS, 250, 5000);
    const maxWaitMs = numParam(url, "maxWaitMs", DEFAULT_MAX_WAIT_MS, 1000, 600000);

    const run = runRow as unknown as RunRow;
    const first = await loadSnapshot(run.id, params.id);
    const events = buildRunEvents({ run, steps: first.steps, evidence: first.evidence });
    let lastId = cursor;
    const initial = events.filter((e) => e.id > cursor);

    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Single snapshot: no polling, deterministic body (tests + curl friendly).
    if (!follow || isTerminalRunStatus(run.status)) {
      const body = initial.map(formatSseEvent).join("");
      return new Response(body, { status: 200, headers });
    }

    // Live-follow: re-project on every poll and emit only new ids until the
    // run reaches a terminal status, the budget expires, or the client goes.
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (chunk: string) => controller.enqueue(enc.encode(chunk));
        try {
          for (const e of initial) {
            send(formatSseEvent(e));
            lastId = Math.max(lastId, e.id);
          }
          let lastBeat = Date.now();
          const deadline = Date.now() + maxWaitMs;
          for (;;) {
            if (req.signal.aborted) break;
            if (Date.now() >= deadline) break;
            await sleep(pollMs);
            if (req.signal.aborted) break;
            const current = (await prisma.agentRun.findFirst({
              where: { id: run.id, orgId, incidentId: params.id },
            })) as unknown as RunRow | null;
            if (!current) {
              send(formatSseEvent(newErrorEvent(lastId + 1, "agent run disappeared")));
              break;
            }
            const snap = await loadSnapshot(current.id, params.id);
            const live = buildRunEvents({ run: current, steps: snap.steps, evidence: snap.evidence });
            for (const e of live) {
              if (e.id > lastId) {
                send(formatSseEvent(e));
                lastId = e.id;
              }
            }
            if (isTerminalRunStatus(current.status)) break;
            if (Date.now() - lastBeat >= HEARTBEAT_MS) {
              send(": ping\n\n");
              lastBeat = Date.now();
            }
          }
        } catch {
          try {
            send(formatSseEvent(newErrorEvent(lastId + 1, "stream interrupted")));
          } catch {
            // Client already gone — just close.
          }
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed/cancelled.
          }
        }
      },
      cancel() {
        // Client disconnected; the start() loop observes req.signal.
      },
    });
    return new Response(stream, { status: 200, headers });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "stream failed" },
      { status: toStatus(e, 500) }
    );
  }
}

function newErrorEvent(id: number, message: string): StreamEvent {
  return { id, type: "stream_error", data: { message } };
}
