// GET /api/incidents/[id]/runs — list AgentRun rows for an incident.
// Org-scoped: the incident must belong to the session org (404 otherwise).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getIncident } from "@/lib/services/incidents";
import { getSession } from "@/lib/auth/session";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(prisma);
    const orgId = session.user.orgId;
    await getIncident(prisma, orgId, params.id);
    const items = await prisma.agentRun.findMany({
      where: { orgId, incidentId: params.id },
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