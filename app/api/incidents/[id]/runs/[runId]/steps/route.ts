// GET /api/incidents/[id]/runs/[runId]/steps — list AgentStep rows for one
// run of an incident. Org-scoped: incident and run must both belong to the
// session org (404 otherwise).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getIncident } from "@/lib/services/incidents";
import { getSession } from "@/lib/auth/session";
import { NotFoundError, toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string; runId: string } }) {
  try {
    const session = await getSession(prisma);
    const orgId = session.user.orgId;
    await getIncident(prisma, orgId, params.id);
    const run = await prisma.agentRun.findFirst({
      where: { id: params.runId, orgId, incidentId: params.id },
    });
    if (!run) throw new NotFoundError("agent run not found");
    const items = await prisma.agentStep.findMany({
      where: { runId: params.runId },
      orderBy: { seq: "asc" },
    });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list steps failed" },
      { status: toStatus(e, 500) }
    );
  }
}