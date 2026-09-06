// POST /api/incidents/[id]/runs/[runId]/cancel — request cancellation of an
// in-flight investigation run.
//
//   getSession → (org-scoped incident check) → (org-scoped run check) → mark CANCELLED
//
// Semantics:
//   - The run must belong to the incident AND the session org (404 otherwise).
//   - Only a RUNNING run can be cancelled: an already-terminal run is returned
//     unchanged (idempotent 200 with its existing status). Cancelling is
//     best-effort — the synchronous investigator loop may already be finishing;
//     the UI stops polling once the run reports CANCELLED/terminal.
//   - The loop aborts on client disconnect; this endpoint is the explicit
//     "stop investigating" action from the run list.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getIncident } from "@/lib/services/incidents";
import { getSession } from "@/lib/auth/session";
import { NotFoundError, toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string; runId: string } }) {
  try {
    const session = await getSession(prisma);
    const orgId = session.user.orgId;
    await getIncident(prisma, orgId, params.id);

    const run = await prisma.agentRun.findFirst({
      where: { id: params.runId, orgId, incidentId: params.id },
    });
    if (!run) throw new NotFoundError("agent run not found");

    let status = run.status;
    if (run.status === "RUNNING") {
      // Transition to CANCELLED and stamp completion. If the loop is genuinely
      // mid-flight it may later overwrite this on finish; the UI treats a run
      // that has left RUNNING as no longer actionable.
      const updated = await prisma.agentRun.update({
        where: { id: run.id },
        data: { status: "CANCELLED", finishedAt: new Date() },
      });
      status = updated.status;
    }

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId: session.user.id,
        action: "investigate.cancel",
        entityType: "AgentRun",
        entityId: run.id,
        metadata: { fromStatus: run.status, toStatus: status } as never,
      },
    });

    return NextResponse.json({ runId: run.id, status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "cancel failed" },
      { status: toStatus(e, 500) }
    );
  }
}
