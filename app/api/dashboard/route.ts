import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/services/dashboard";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getSession(prisma);
    const url = new URL(req.url);
    const yearParam = url.searchParams.get("year");
    const year = yearParam ? Number(yearParam) : undefined;
    const org = await prisma.organization.findUnique({
      where: { id: session.user.orgId },
      select: { id: true, name: true, slug: true },
    });
    const data = await getDashboardData(
      prisma,
      session.user.orgId,
      year !== undefined && Number.isInteger(year) ? year : undefined
    );
    return NextResponse.json({
      org: org ?? { id: session.user.orgId, name: "", slug: "" },
      ...data,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "dashboard failed";
    return NextResponse.json({ error: message }, { status: toStatus(e, 500) });
  }
}
