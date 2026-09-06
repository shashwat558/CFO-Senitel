// GET /api/incidents/[id]/evidence — org-scoped evidence ledger with lineage.
// Filters: ?findingId=&toolName=&sourceType=. Pagination via ?page=&pageSize=.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { listEvidence } from "@/lib/evidence/service";
import { toStatus } from "@/lib/services/errors";
import { paginationSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(prisma);
    const orgId = session.user.orgId;
    const url = new URL(req.url);
    const pagination = paginationSchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const data = await listEvidence(prisma, orgId, params.id, {
      page: pagination.success ? pagination.data.page : 1,
      pageSize: pagination.success ? pagination.data.pageSize : 20,
      findingId: url.searchParams.get("findingId") ?? undefined,
      toolName: url.searchParams.get("toolName") ?? undefined,
      sourceType: url.searchParams.get("sourceType") ?? undefined,
    });
    return NextResponse.json({ orgId, incidentId: params.id, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list evidence failed" },
      { status: toStatus(e, 500) }
    );
  }
}
