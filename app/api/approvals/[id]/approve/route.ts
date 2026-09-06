// POST /api/approvals/[id]/approve — approve a PENDING approval.
//
// Org-scoped. Role-check stub: when a decidedById is supplied it must be an
// org user with an approver role (403 otherwise); no auth yet → actor null.
// Drives the linked action PROPOSED → APPROVED and writes an AuditLog.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { decideApproval } from "@/lib/services/approvals";
import { getDefaultOrg } from "@/lib/services/org";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const org = await getDefaultOrg(prisma);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // The endpoint (not the body) decides; ignore body-level approvalId/decision.
    const { approvalId: _ignored, decision: _ignored2, ...rest } = body;
    const result = await decideApproval(prisma, org.id, {
      approvalId: params.id,
      decision: "APPROVED",
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