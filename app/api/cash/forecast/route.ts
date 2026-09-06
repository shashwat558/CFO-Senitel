// GET /api/cash/forecast — 13-week cash projection for the session org.
// Thin wrapper over the deterministic projectCash service (same numbers the
// investigator tools read). Query: ?asOf=ISO (default 2025-01-01, the seeded
// planning anchor) &weeks=1..26 (default 13).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { projectCash } from "@/lib/financial/cashForecast";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getSession(prisma);
    const url = new URL(req.url);
    const asOfParam = url.searchParams.get("asOf");
    const weeksParam = url.searchParams.get("weeks");
    const asOf = asOfParam ? new Date(asOfParam) : undefined;
    if (asOfParam && (asOf === undefined || Number.isNaN(asOf.getTime()))) {
      return NextResponse.json({ error: "invalid asOf date" }, { status: 400 });
    }
    const weeks = weeksParam === null || weeksParam === "" ? undefined : Number(weeksParam);
    if (weeks !== undefined && (!Number.isInteger(weeks) || weeks < 1 || weeks > 26)) {
      return NextResponse.json({ error: "weeks must be an integer 1..26" }, { status: 400 });
    }
    const data = await projectCash(prisma, session.user.orgId, {
      ...(asOf ? { asOf } : {}),
      ...(weeks !== undefined ? { weeks } : {}),
    });
    return NextResponse.json({ orgId: session.user.orgId, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "cash forecast failed" },
      { status: toStatus(e, 500) }
    );
  }
}
