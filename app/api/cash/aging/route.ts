// GET /api/cash/aging?side=ar|ap — receivables/payables aging snapshot.
// Thin wrapper over the deterministic aging service (same buckets the
// investigator tools read). Query: ?side=ar (default) |ap, ?asOf=ISO
// (default 2025-01-01, the seeded planning anchor).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { getApAging, getArAging } from "@/lib/financial/aging";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getSession(prisma);
    const url = new URL(req.url);
    const side = url.searchParams.get("side") ?? "ar";
    if (side !== "ar" && side !== "ap") {
      return NextResponse.json({ error: "side must be ar or ap" }, { status: 400 });
    }
    const asOfParam = url.searchParams.get("asOf");
    const asOf = asOfParam ? new Date(asOfParam) : new Date("2025-01-01T00:00:00.000Z");
    if (Number.isNaN(asOf.getTime())) {
      return NextResponse.json({ error: "invalid asOf date" }, { status: 400 });
    }
    const data = side === "ar"
      ? await getArAging(prisma, session.user.orgId, asOf)
      : await getApAging(prisma, session.user.orgId, asOf);
    return NextResponse.json({ orgId: session.user.orgId, side, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "aging failed" },
      { status: toStatus(e, 500) }
    );
  }
}
