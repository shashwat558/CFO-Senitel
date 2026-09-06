// Scheduled sync (pull → stage → promote) + /api/connect/sync routes +
// bank source filter. Connectors and prisma are mocked — zero network.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isConnectorId,
  resolveConnector,
  runScheduledSync,
} from "../lib/connectors/scheduler";
import type { Connector, NormalizedRecord } from "../lib/connectors/types";
import { executeTool } from "../lib/tools/registry";

const ORG = "org_acme_industries";
const AT = new Date("2024-08-11T10:00:00.000Z");

function record(over: Partial<NormalizedRecord> & { externalId: string }): NormalizedRecord {
  return {
    kind: "payment",
    occurredAt: AT,
    currency: "INR",
    amount: 3590.4,
    customer: { externalId: "cus_1", email: "a@example.com", name: "Acme Buyer" },
    status: "succeeded",
    raw: { payment_id: over.externalId },
    ...over,
  };
}

function fakeConnector(records: NormalizedRecord[]): Connector {
  return {
    id: "dodo",
    displayName: "Fake",
    pull: vi.fn(async () => ({ records, cursor: AT })),
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
      findMany: vi.fn().mockResolvedValue([]),
    },
    stagedRecord: {
      findMany: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        // promote() re-reads STAGED rows; serve the two-record fixture there
        if ((args.where as { status?: string }).status === "STAGED") {
          return Promise.resolve([
            { id: "st_pay", provider: "dodo", kind: "payment", externalId: "pay_1", occurredAt: AT, currency: "INR", amount: 3590.4, customerExternalId: "cus_1", customerEmail: "a@example.com", customerName: "Acme Buyer", raw: {} },
            { id: "st_po", provider: "dodo", kind: "payout", externalId: "po_1", occurredAt: AT, currency: "INR", amount: 5000, customerExternalId: null, customerEmail: null, customerName: null, raw: {} },
          ]);
        }
        return Promise.resolve([]);
      }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
    customer: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "cus_db_1" }),
    },
    invoice: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "inv_db_1" }),
    },
    journalEntry: { create: vi.fn().mockResolvedValue({ id: "je_db_1" }) },
    account: {
      findFirst: vi.fn().mockImplementation((args: { where: { code?: string; type?: string } }) =>
        Promise.resolve({ id: `acct_${args.where.code ?? args.where.type}` })
      ),
    },
    transaction: { create: vi.fn().mockResolvedValue({ id: "tx_db_1" }), findMany: vi.fn().mockResolvedValue([]) },
    bankAccount: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: "bank_operating" }),
    },
    bankTransaction: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "bt_db_1" }),
    },
    budget: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

describe("resolveConnector", () => {
  it("resolves dodo and rejects unknown providers", () => {
    expect(isConnectorId("dodo")).toBe(true);
    expect(isConnectorId("xero")).toBe(false);
    expect(resolveConnector("dodo").id).toBe("dodo");
    expect(() => resolveConnector("nope")).toThrow(/unknown connector/);
  });
});

describe("runScheduledSync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pulls, stages, and promotes in one audited pass", async () => {
    const db = mockDb();
    const res = await runScheduledSync(db as never, ORG, {
      connector: fakeConnector([record({ externalId: "pay_1" })]),
    });
    expect(res.provider).toBe("dodo");
    expect(res.pull).toMatchObject({ pulled: 1, staged: 1, skipped: 0 });
    // promote() picks up the two STAGED fixtures: payment → invoice, payout → bank leg
    expect(res.promote).toMatchObject({ promoted: 2, rejected: 0 });
    expect(db.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) })
    );
    expect(db.invoice.create).toHaveBeenCalled();
    expect(db.bankTransaction.create).toHaveBeenCalled();
  });

  it("never promotes when the pull fails", async () => {
    const db = mockDb();
    const failing: Connector = {
      ...fakeConnector([]),
      pull: vi.fn(async () => {
        throw Object.assign(new Error("down"), { code: "NETWORK" });
      }),
    };
    await expect(runScheduledSync(db as never, ORG, { connector: failing })).rejects.toThrow("down");
    expect(db.customer.create).not.toHaveBeenCalled();
    expect(db.bankTransaction.create).not.toHaveBeenCalled();
    expect(db.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });

  it("requires orgId", async () => {
    await expect(runScheduledSync(mockDb() as never, "", { connector: fakeConnector([]) })).rejects.toThrow(
      /orgId/
    );
  });
});

describe("getBankTransactions source filter", () => {
  it("scopes Dodo-imported legs for the collections query", async () => {
    const legs = [
      { id: "bt_1", bankAccountId: "b1", date: new Date("2024-08-11T00:00:00Z"), description: "Dodo payout", amount: 5000, status: "PENDING", source: "DODO_IMPORT", invoiceId: null },
    ];
    const tdb = mockDb({
      bankTransaction: {
        findMany: vi.fn().mockResolvedValue(legs),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    });
    const out = (await executeTool(
      "getBankTransactions",
      { orgId: ORG, source: "DODO_IMPORT" },
      { db: tdb as never, orgId: ORG }
    )) as Array<{ source: string }>;
    expect(tdb.bankTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ source: "DODO_IMPORT" }) })
    );
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("DODO_IMPORT");
  });

  it("rejects unknown sources at validation", async () => {
    await expect(
      executeTool("getBankTransactions", { orgId: ORG, source: "NOPE" }, { db: mockDb() as never, orgId: ORG })
    ).rejects.toThrow(/invalid input/i);
  });
});
