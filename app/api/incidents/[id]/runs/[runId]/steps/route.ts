// GET /api/incidents/[id]/runs/[runId]/steps — list AgentStep rows for one
// run of an incident. Org-scoped: incident and run must both belong to the
// default org (404 otherwise).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getIncident } from "@/lib/services/incidents";
import { getDefaultOrg } from "@/lib/services/org";
import { NotFoundError, toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string; runId: string } }) {
  try {
    const org = await getDefaultOrg(prisma);
    await getIncident(prisma, org.id, params.id);
    const run = await prisma.agentRun.findFirst({
      where: { id: params.runId, orgId: org.id, incidentId: params.id },
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