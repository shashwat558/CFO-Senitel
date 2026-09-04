import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { listIncidents, createIncident } from "@/lib/services/incidents";
import { getDefaultOrg } from "@/lib/services/org";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const org = await getDefaultOrg(prisma);
    const data = await listIncidents(prisma, org.id, {
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize: Number(url.searchParams.get("pageSize") ?? 20),
      status: url.searchParams.get("status") ?? undefined,
    });
    return NextResponse.json({ orgId: org.id, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!body.orgId) {
      const org = await getDefaultOrg(prisma);
      body.orgId = org.id;
    }
    const incident = await createIncident(prisma, body);
    return NextResponse.json(incident, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status }
    );
  }
}
