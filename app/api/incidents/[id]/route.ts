import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getIncident, updateIncident } from "@/lib/services/incidents";
import { getSession } from "@/lib/auth/session";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(prisma);
    const incident = await getIncident(prisma, session.user.orgId, params.id);
    return NextResponse.json(incident);
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json({ error: message }, { status: toStatus(e, 500) });
  }
}

// PATCH /api/incidents/[id] — transition status along
// OPEN → INVESTIGATING → PENDING_APPROVAL → RESOLVED/CLOSED (reusing the
// investigation phase edges; invalid moves surface as 400 ValidationError)
// and/or assign the incident to an org user. Org-scoped like every route:
// session.user.orgId is the tenant and the session user is the audit actor.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(prisma);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const incident = await updateIncident(prisma, session.user.orgId, params.id, body, {
      actorId: session.user.id,
    });
    return NextResponse.json(incident);
  } catch (e) {
    const message = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: message }, { status: toStatus(e, 500) });
  }
}