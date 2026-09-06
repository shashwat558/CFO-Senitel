// GET /api/incidents/[id]/evidence/[evidenceId] — one evidence row.
// ?expand=source resolves the lineage source row org-scoped
// (missing/unmodeled source → { row: null, reason }, never fabricated).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { getEvidenceDetail } from "@/lib/evidence/service";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string; evidenceId: string } }
) {
  try {
    const session = await getSession(prisma);
    const orgId = session.user.orgId;
    const url = new URL(req.url);
    const item = await getEvidenceDetail(prisma, orgId, params.id, params.evidenceId, {
      expandSource: url.searchParams.get("expand") === "source",
    });
    return NextResponse.json(item);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch evidence failed" },
      { status: toStatus(e, 500) }
    );
  }
}
