import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getDefaultOrg } from "@/lib/services/org";
import { getDashboardData } from "@/lib/services/dashboard";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const org = await getDefaultOrg(prisma);
    const url = new URL(req.url);
    const yearParam = url.searchParams.get("year");
    const year = yearParam ? Number(yearParam) : undefined;
    const data = await getDashboardData(
      prisma,
      org.id,
      year !== undefined && Number.isInteger(year) ? year : undefined
    );
    return NextResponse.json({ org: { id: org.id, name: org.name, slug: org.slug }, ...data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "dashboard failed";
    return NextResponse.json({ error: message }, { status: toStatus(e, 500) });
  }
}
