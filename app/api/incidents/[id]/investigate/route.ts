// POST /api/incidents/[id]/investigate — run the Investigator Agent loop for
// an incident, synchronously, and report the persistent run.
//
//   getDefaultOrg → (org-scoped incident check) → runInvestigatorLoop
//
// The loop persists an AgentRun + AgentStep rows + IncidentEvidence rows as
// it goes. Every LoopStatus maps to HTTP 200 with { status, runId }; clients
// poll GET /api/incidents/[id]/runs and /runs/[runId]/steps for details.
//
// A whole-loop AbortSignal bounds the run (each LLM call already enforces its
// own INVESTIGATOR_TIMEOUT_MS); abort lands the run in CANCELLED status.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createInvestigatorClient } from "@/lib/ai/investigator-client";
import { runInvestigatorLoop } from "@/lib/agent/investigator-loop";
import { getIncident } from "@/lib/services/incidents";
import { getDefaultOrg } from "@/lib/services/org";
import { toStatus, ValidationError } from "@/lib/services/errors";
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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), loopTimeoutMs());
  try {
    // Single-tenant Phase-1: investigate inside the default org.
    const org = await getDefaultOrg(prisma);
    // Org isolation: the incident must belong to this org (404 otherwise).
    await getIncident(prisma, org.id, params.id);

    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = investigateIncidentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(`invalid investigation request: ${parsed.error.message}`);
    }
    const { question, maxIterations, actorId } = parsed.data;

    const result = await runInvestigatorLoop({
      db: prisma,
      llm: createInvestigatorClient(),
      toolCtx: { db: prisma, orgId: org.id, actorId },
      orgId: org.id,
      incidentId: params.id,
      question,
      maxIterations,
      actorId,
      signal: controller.signal,
    });

    // LoopStatus → 200 { status, runId }: the AgentRun row records the
    // full outcome (output/answer/iterations) for /runs consumers.
    return NextResponse.json({ status: result.status, runId: result.runId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "investigation failed" },
      { status: toStatus(e, 500) }
    );
  } finally {
    clearTimeout(timer);
  }
}