import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { listIncidents, createIncident } from "@/lib/services/incidents";
import { getSession } from "@/lib/auth/session";
import { toStatus } from "@/lib/services/errors";
import { paginationSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const session = await getSession(prisma);
    const orgId = session.user.orgId;
    const pagination = paginationSchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const data = await listIncidents(prisma, orgId, {
      page: pagination.success ? pagination.data.page : 1,
      pageSize: pagination.success ? pagination.data.pageSize : 20,
      status: url.searchParams.get("status") ?? undefined,
    });
    return NextResponse.json({ orgId, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list failed" },
      { status: toStatus(e, 500) }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession(prisma);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // The tenant comes from the session — a client-supplied orgId is stripped
    // by the create schema and can never override session.user.orgId.
    const incident = await createIncident(prisma, session.user.orgId, body, {
      actorId: session.user.id,
    });
    return NextResponse.json(incident, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status: toStatus(e, 500) }
    );
  }
}