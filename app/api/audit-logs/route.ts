import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

// GET /api/audit-logs?limit=50&actor=&action=&entityType=
// Org-scoped audit trail. Every write path (status changes, approvals,
// investigate.cancel, verification runs) appends an AuditLog row; this thin
// reader exposes them for the governance viewer UI.
export async function GET(req: Request) {
  try {
    const session = await getSession(prisma);
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(
      200,
      Math.max(1, limitParam ? Number(limitParam) || 50 : 50)
    );

    const actor = url.searchParams.get("actor")?.trim() || undefined;
    const action = url.searchParams.get("action")?.trim() || undefined;
    const entityType = url.searchParams.get("entityType")?.trim() || undefined;

    const items = await prisma.auditLog.findMany({
      where: {
        orgId: session.user.orgId,
        ...(actor ? { actorId: actor } : {}),
        ...(action ? { action } : {}),
        ...(entityType ? { entityType } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "audit logs failed" },
      { status: toStatus(e, 500) }
    );
  }
}
