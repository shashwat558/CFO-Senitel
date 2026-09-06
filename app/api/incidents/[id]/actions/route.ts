// POST /api/incidents/[id]/actions — propose an IncidentAction for a finding.
//
// Org-scoped: the incident and the finding must belong to the default org.
// Creates the action (status PROPOSED, payload records the findingId) and
// opens a PENDING Approval for it, then appends an AuditLog (actor null
// until auth lands).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { proposeAction } from "@/lib/services/actions";
import { getDefaultOrg } from "@/lib/services/org";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const org = await getDefaultOrg(prisma);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Single-tenant Phase-1: the incident comes from the URL; a client-supplied
    // incidentId is ignored (same rule as orgId on the create route).
    body.incidentId = params.id;
    const result = await proposeAction(prisma, org.id, body);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "propose action failed" },
      { status: toStatus(e, 500) }
    );
  }
}