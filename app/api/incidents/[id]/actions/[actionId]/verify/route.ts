// POST /api/incidents/[id]/actions/[actionId]/verify — verify an EXECUTED
// action by re-querying the evidence its payload names and comparing fresh
// figures against claimed ones. Marks VERIFIED (may auto-transition the
// incident) or FAILED with the mismatch detail. Never claims without proof.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyAction } from "@/lib/verification/runner";
import { getSession } from "@/lib/auth/session";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    const result = await verifyAction(prisma, session.user.orgId, params.actionId, {
      actorId: session.user.id,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "verify failed" },
      { status: toStatus(e, 500) }
    );
  }
}
