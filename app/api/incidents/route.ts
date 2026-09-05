import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { listIncidents, createIncident } from "@/lib/services/incidents";
import { getDefaultOrg } from "@/lib/services/org";
import { toStatus } from "@/lib/services/errors";
import { paginationSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const org = await getDefaultOrg(prisma);
    const pagination = paginationSchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const data = await listIncidents(prisma, org.id, {
      page: pagination.success ? pagination.data.page : 1,
      pageSize: pagination.success ? pagination.data.pageSize : 20,
      status: url.searchParams.get("status") ?? undefined,
    });
    return NextResponse.json({ orgId: org.id, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list failed" },
      { status: toStatus(e, 500) }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Single-tenant Phase-1: always scope to the default org. Client-supplied
    // orgId is ignored to prevent tenant spoofing (no auth yet).
    const org = await getDefaultOrg(prisma);
    body.orgId = org.id;
    const incident = await createIncident(prisma, body);
    return NextResponse.json(incident, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status: toStatus(e, 500) }
    );
  }
}
