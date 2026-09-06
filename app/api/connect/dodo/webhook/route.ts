// POST /api/connect/dodo/webhook — Dodo Payments event receiver.
//
// Verify-first: the raw body is signature-checked via the SDK BEFORE any
// parsing or staging; failures answer 401 and touch nothing. Verified money
// events stage idempotently (redelivery-safe); lifecycle noise (subscription
// churn, processing updates) acknowledges without staging. Promotion into the
// books is the C5 scheduler's job — this route only stages. Fast 200s keep
// provider retries away.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { DodoConnector } from "@/lib/connectors/dodo";
import { stageNormalizedRecords } from "@/lib/connectors/sync";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await getSession(prisma);
    const orgId = session.user.orgId;
    const raw = await req.text();
    if (!raw) {
      return NextResponse.json({ error: "empty webhook body" }, { status: 400 });
    }
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const verified = await new DodoConnector().verifyWebhook(raw, headers);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error ?? "invalid signature" }, { status: 401 });
    }

    try {
      await prisma.auditLog.create({
        data: {
          orgId,
          actorId: null, // provider-driven, no user behind it
          action: "connector.webhook",
          entityType: "Webhook",
          entityId: verified.eventType ?? "unknown",
          metadata: { provider: "dodo", eventType: verified.eventType ?? null } as never,
        },
      });
    } catch {
      // Audit must never fail the webhook response.
    }

    if (!verified.record) {
      return NextResponse.json({ received: true, staged: 0, skipped: 0, eventType: verified.eventType ?? null });
    }
    const { staged, skipped } = await stageNormalizedRecords(prisma, orgId, "dodo", [
      verified.record,
    ]);
    return NextResponse.json({
      received: true,
      staged,
      skipped,
      eventType: verified.eventType ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "webhook failed" },
      { status: toStatus(e, 500) }
    );
  }
}
