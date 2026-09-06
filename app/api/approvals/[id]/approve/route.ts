// POST /api/approvals/[id]/approve — approve a PENDING approval.
//
// Org-scoped. The session user is the decider: role gate CFO/CONTROLLER
// (403 for VIEWER/other), decidedById = session.user.id, and the AuditLog
// actor is the session user. Drives the linked action PROPOSED → APPROVED.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { decideApproval } from "@/lib/services/approvals";
import { getSession } from "@/lib/auth/session";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(prisma);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // The endpoint + session decide: ignore body-level approvalId/decision and
    // any client-supplied decider (never spoof the actor).
    const { approvalId: _ignored, decision: _ignored2, decidedById: _ignored3, ...rest } = body;
    const result = await decideApproval(prisma, session.user.orgId, {
      approvalId: params.id,
      decision: "APPROVED",
      decidedById: session.user.id,
      ...rest,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "approve failed" },
      { status: toStatus(e, 500) }
    );
  }
}