// Connector sync — pull provider events and stage them idempotently.
//
// One runConnectorPull() invocation = one SyncRun ledger row: it resolves the
// watermark (explicit `since` → last COMPLETED cursor → 90-day default), pulls
// via the Connector, inserts only unseen external ids, then marks the run
// COMPLETED with counts + new cursor. Failures mark the run FAILED with the
// error (retryable flag preserved on ConnectorError) and audit both paths.
// Promotion into the books is C3; the agent never reads staged rows.

import type { PrismaClient } from "@prisma/client";
import {
  ConnectorError,
  type Connector,
  type NormalizedRecord,
} from "./types";

export interface RunPullOpts {
  /** Explicit watermark; overrides the stored cursor. */
  since?: Date;
  actorId?: string;
}

export interface RunPullResult {
  syncRunId: string;
  pulled: number;
  staged: number;
  skipped: number;
  cursor: Date;
  counts: Record<string, number>;
}

const DEFAULT_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

async function resolveSince(
  db: PrismaClient,
  orgId: string,
  provider: string,
  explicit?: Date
): Promise<Date> {
  if (explicit) {
    if (Number.isNaN(explicit.getTime())) {
      throw new ConnectorError("CONFIG", "pull requires a valid since date", false);
    }
    return explicit;
  }
  const last = await db.syncRun.findFirst({
    where: { orgId, provider, status: "COMPLETED", cursor: { not: null } },
    orderBy: { finishedAt: "desc" },
  });
  const cursor = (last as { cursor?: Date | string | null } | null)?.cursor;
  if (cursor) return new Date(cursor);
  return new Date(Date.now() - DEFAULT_LOOKBACK_MS);
}

function toCounts(records: NormalizedRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  return counts;
}

/**
 * Pull + stage for one (org, connector). Idempotent: re-running with the
 * same watermark inserts zero new rows and still advances the ledger.
 */
export async function runConnectorPull(
  db: PrismaClient,
  orgId: string,
  connector: Connector,
  opts: RunPullOpts = {}
): Promise<RunPullResult> {
  if (!orgId) throw new ConnectorError("CONFIG", "orgId is required", false);
  const since = await resolveSince(db, orgId, connector.id, opts.since);

  const run = (await db.syncRun.create({
    data: { orgId, provider: connector.id, status: "RUNNING", cursor: since },
  })) as { id: string };

  const finish = async (
    status: "COMPLETED" | "FAILED",
    patch: Record<string, unknown>
  ): Promise<void> => {
    await db.syncRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), ...patch } as never,
    });
  };
  const audit = async (action: string, metadata: Record<string, unknown>): Promise<void> => {
    try {
      await db.auditLog.create({
        data: {
          orgId,
          actorId: opts.actorId ?? null,
          action,
          entityType: "SyncRun",
          entityId: run.id,
          metadata: metadata as never,
        },
      });
    } catch {
      // Ledger writes must never fail the sync response.
    }
  };

  try {
    const { records, cursor } = await connector.pull(since);

    // Idempotency: skip external ids already staged for this org+provider.
    let skipped = 0;
    const fresh: NormalizedRecord[] = [];
    if (records.length > 0) {
      const keys = records.map((r) => ({ kind: r.kind, externalId: r.externalId }));
      const existing = (await db.stagedRecord.findMany({
        where: {
          orgId,
          provider: connector.id,
          OR: keys.map((k) => ({ kind: k.kind, externalId: k.externalId })),
        },
        select: { kind: true, externalId: true },
      })) as Array<{ kind: string; externalId: string }>;
      const seen = new Set(existing.map((e) => `${e.kind}:${e.externalId}`));
      for (const r of records) {
        if (seen.has(`${r.kind}:${r.externalId}`)) skipped++;
        else fresh.push(r);
      }
      if (fresh.length > 0) {
        await db.stagedRecord.createMany({
          data: fresh.map((r) => ({
            orgId,
            provider: connector.id,
            kind: r.kind,
            externalId: r.externalId,
            occurredAt: r.occurredAt,
            currency: r.currency,
            amount: r.amount,
            customerExternalId: r.customer?.externalId ?? null,
            customerEmail: r.customer?.email ?? null,
            customerName: r.customer?.name ?? null,
            status: "STAGED",
            raw: (r.raw ?? {}) as never,
          })),
          skipDuplicates: true,
        });
      }
    }

    const counts = toCounts(records);
    const result: RunPullResult = {
      syncRunId: run.id,
      pulled: records.length,
      staged: fresh.length,
      skipped,
      cursor,
      counts,
    };
    await finish("COMPLETED", { cursor, counts });
    await audit("connector.sync", {
      provider: connector.id,
      pulled: result.pulled,
      staged: result.staged,
      skipped: result.skipped,
      cursor: result.cursor.toISOString(),
      counts,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = err instanceof ConnectorError ? err.retryable : false;
    await finish("FAILED", { error: message });
    await audit("connector.sync", { provider: connector.id, error: message, retryable });
    throw err;
  }
}
