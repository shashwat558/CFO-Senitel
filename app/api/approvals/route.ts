import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

// GET /api/approvals?status=PENDING — org-scoped approval queue with
// linked action + incident titles for the governance UI.
export async function GET(req: Request) {
  try {
    const session = await getSession(prisma);
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "PENDING";
    const items = await prisma.approval.findMany({
      where: { orgId: session.user.orgId, status: status as never },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        action: { select: { id: true, title: true, status: true, incidentId: true } },
        incident: { select: { id: true, title: true } },
      },
    });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "approvals failed" },
      { status: toStatus(e, 500) }
    );
  }
}
