// GET /api/incidents/[id]/runs — list AgentRun rows for an incident.
// Org-scoped: the incident must belong to the default org (404 otherwise).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getIncident } from "@/lib/services/incidents";
import { getDefaultOrg } from "@/lib/services/org";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const org = await getDefaultOrg(prisma);
    await getIncident(prisma, org.id, params.id);
    const items = await prisma.agentRun.findMany({
      where: { orgId: org.id, incidentId: params.id },
      orderBy: { startedAt: "desc" },
      include: { _count: { select: { steps: true } } },
    });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list runs failed" },
      { status: toStatus(e, 500) }
    );
  }
}