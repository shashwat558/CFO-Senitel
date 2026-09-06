// /api/connect/sync — scheduled connector ticks.
//
// POST {provider?} runs pull → stage → promote for one provider and returns
// the combined summary. Built for an external scheduler (cron/Vercel hitting
// this endpoint on an interval). NOTE (v1 stub auth): getSession resolves the
// seeded default user, so any caller can trigger a sync today — gate this
// behind real auth/roles before multi-user, and never expose provider keys
// to the client (they stay server-side env).
// GET lists recent SyncRun ledger rows so silent sync death is visible.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { CONNECTOR_IDS, runScheduledSync } from "@/lib/connectors/scheduler";
import { toStatus, ValidationError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const syncBodySchema = z.object({
  provider: z.enum(CONNECTOR_IDS).default("dodo"),
});

export async function POST(req: Request) {
  try {
    const session = await getSession(prisma);
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = syncBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(`invalid sync request: ${parsed.error.message}`);
    }
    const result = await runScheduledSync(prisma, session.user.orgId, {
      provider: parsed.data.provider,
      actorId: session.user.id,
    });
    return NextResponse.json(
      {
        orgId: session.user.orgId,
        provider: result.provider,
        pulled: result.pull.pulled,
        staged: result.pull.staged,
        skipped: result.pull.skipped,
        promoted: result.promote.promoted,
        rejected: result.promote.rejected,
        cursor: result.pull.cursor.toISOString(),
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "sync failed" },
      { status: toStatus(e, 500) }
    );
  }
}

export async function GET(req: Request) {
  try {
    const session = await getSession(prisma);
    const url = new URL(req.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? 20);
    const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 20;
    const runs = await prisma.syncRun.findMany({
      where: { orgId: session.user.orgId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ orgId: session.user.orgId, runs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list sync runs failed" },
      { status: toStatus(e, 500) }
    );
  }
}
