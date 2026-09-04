import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getDefaultOrg } from "@/lib/services/org";
import { getDashboardData } from "@/lib/services/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const org = await getDefaultOrg(prisma);
    const data = await getDashboardData(prisma, org.id);
    return NextResponse.json({ org: { id: org.id, name: org.name, slug: org.slug }, ...data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "dashboard failed";
    const status = /no organization|run `npx prisma db seed`/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
