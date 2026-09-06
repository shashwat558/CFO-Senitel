// POST /api/incidents/[id]/actions — propose an IncidentAction for a finding.
//
// Org-scoped: the incident and the finding must belong to the session org.
// Creates the action (status PROPOSED, payload records the findingId) and
// opens a PENDING Approval for it (requested by the session user), then
// appends an AuditLog attributed to the session user.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { proposeAction } from "@/lib/services/actions";
import { getSession } from "@/lib/auth/session";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(prisma);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // The incident comes from the URL; a client-supplied incidentId/orgId is
    // ignored (same rule as orgId on the create route).
    body.incidentId = params.id;
    const result = await proposeAction(prisma, session.user.orgId, body, {
      actorId: session.user.id,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "propose action failed" },
      { status: toStatus(e, 500) }
    );
  }
}