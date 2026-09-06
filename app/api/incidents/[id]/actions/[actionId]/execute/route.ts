// POST /api/incidents/[id]/actions/[actionId]/execute — run the simulated
// execution worker for an APPROVED action (marks EXECUTED with a
// simulationResult, or FAILED). Org-scoped via the action's incident;
// role gate CFO/CONTROLLER (403 otherwise); session user is the audit actor.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { executeAction } from "@/lib/services/actions";
import { getSession } from "@/lib/auth/session";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string; actionId: string } }) {
  try {
    const session = await getSession(prisma);
    const action = await prisma.incidentAction.findFirst({
      where: { id: params.actionId, incidentId: params.id, incident: { orgId: session.user.orgId } },
      select: { id: true },
    });
    if (!action) {
      return NextResponse.json({ error: "action not found" }, { status: 404 });
    }
    const result = await executeAction(prisma, session.user.orgId, params.actionId, {
      actor: { id: session.user.id, role: session.user.role },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "execute failed" },
      { status: toStatus(e, 500) }
    );
  }
}
