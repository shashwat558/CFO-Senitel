// Connector sync (pull + stage): watermark resolution, idempotent re-pull,
// cursor advance, failure ledger. The Connector is faked — zero network.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { runConnectorPull } from "../lib/connectors/sync";
import { ConnectorError, type Connector, type NormalizedRecord } from "../lib/connectors/types";

const ORG = "org_acme_industries";

function record(over: Partial<NormalizedRecord> & { externalId: string }): NormalizedRecord {
  return {
    kind: "payment",
    occurredAt: new Date("2024-08-11T10:00:00.000Z"),
    currency: "INR",
    amount: 100,
    customer: null,
    status: "succeeded",
    raw: { externalId: over.externalId },
    ...over,
  };
}

function fakeConnector(
  records: NormalizedRecord[],
  opts: { fail?: unknown; cursor?: Date } = {}
): Connector {
  return {
    id: "dodo",
    displayName: "Fake",
    pull: vi.fn(async (since: Date) => {
      if (opts.fail) throw opts.fail;
      if (!(since instanceof Date) || Number.isNaN(since.getTime())) {
        throw new Error("since must be a Date");
      }
      return {
        records,
        cursor: opts.cursor ?? new Date("2024-08-20T00:00:00.000Z"),
      };
    }),
    verifyWebhook: vi.fn(async () => ({ ok: false as const, error: "unused" })),
  };
}

function mockDb(overrides: Record<string, unknown> = {}) {
  return {
    syncRun: {
      create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "sync_1", ...args.data })
      ),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    stagedRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

describe("runConnectorPull", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stages fresh records and advances the ledger", async () => {
    const db = mockDb();
    const res = await runConnectorPull(db as never, ORG, fakeConnector([record({ externalId: "a" }), record({ externalId: "b", kind: "refund", amount: -5 })]), {
      since: new Date("2024-08-01T00:00:00.000Z"),
    });
    expect(res).toMatchObject({ pulled: 2, staged: 2, skipped: 0, syncRunId: "sync_1" });
    expect(res.counts).toEqual({ payment: 1, refund: 1 });
    expect(db.stagedRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
    const created = (db.stagedRecord.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(created[0]).toMatchObject({
      orgId: ORG,
      provider: "dodo",
      kind: "payment",
      externalId: "a",
      status: "STAGED",
    });
    expect(created[0].raw).toMatchObject({ externalId: "a" });
    expect(db.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) })
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "connector.sync", entityId: "sync_1" }),
      })
    );
  });

  it("re-pull is a no-op: unseen zero, ledger still advances", async () => {
    const db = mockDb({
      stagedRecord: {
        findMany: vi.fn().mockResolvedValue([{ kind: "payment", externalId: "a" }]),
        createMany: vi.fn(),
      },
    });
    const res = await runConnectorPull(db as never, ORG, fakeConnector([record({ externalId: "a" })]), {
      since: new Date("2024-08-01T00:00:00.000Z"),
    });
    expect(res).toMatchObject({ pulled: 1, staged: 0, skipped: 1 });
    expect(db.stagedRecord.createMany).not.toHaveBeenCalled();
  });

  it("resolves since from the last completed cursor, else 90-day default", async () => {
    const cursor = new Date("2024-07-01T00:00:00.000Z");
    const db = mockDb({
      syncRun: {
        create: vi.fn().mockResolvedValue({ id: "sync_9" }),
        update: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue({ cursor }),
      },
    });
    const connector = fakeConnector([]);
    await runConnectorPull(db as never, ORG, connector);
    expect(connector.pull).toHaveBeenCalledWith(cursor);

    const fallbackDb = mockDb();
    const probe = fakeConnector([]);
    await runConnectorPull(fallbackDb as never, ORG, probe);
    const got = (probe.pull as ReturnType<typeof vi.fn>).mock.calls[0][0] as Date;
    expect(Date.now() - got.getTime()).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
  });

  it("marks the run FAILED with the error and still audits", async () => {
    const db = mockDb();
    const failing = fakeConnector([], { fail: new ConnectorError("RATE_LIMITED", "slow down", true) });
    await expect(
      runConnectorPull(db as never, ORG, failing, { since: new Date() })
    ).rejects.toMatchObject({ name: "ConnectorError", code: "RATE_LIMITED" });
    expect(db.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", error: "slow down" }),
      })
    );
    expect(db.auditLog.create).toHaveBeenCalled();
    expect(db.stagedRecord.createMany).not.toHaveBeenCalled();
  });

  it("requires orgId and a valid since", async () => {
    const db = mockDb();
    await expect(runConnectorPull(db as never, "", fakeConnector([]))).rejects.toThrow(/orgId/);
    await expect(
      runConnectorPull(db as never, ORG, fakeConnector([]), { since: new Date("nope") })
    ).rejects.toThrow(/valid since date/);
  });
});
