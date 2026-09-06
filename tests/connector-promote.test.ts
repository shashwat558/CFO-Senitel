// Promotion engine: staged Dodo rows into the books (mocked Prisma).
// Verifies per-kind mapping, natural-key adoption (no duplicates on replay),
// per-row rejection isolation, and the audit trail.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { promoteStagedRecords } from "../lib/connectors/promote";

const ORG = "org_acme_industries";
const AT = new Date("2024-08-11T10:00:00.000Z");

function staged(over: Record<string, unknown>) {
  return {
    id: `st_${String(over.externalId)}`,
    provider: "dodo",
    kind: "payment",
    externalId: "x",
    occurredAt: AT,
    currency: "INR",
    amount: 3590.4, // major units (pull already converts) → ~$42.80
    customerExternalId: "cus_1",
    customerEmail: "a@example.com",
    customerName: "Acme Buyer",
    raw: { payment_id: "pay_1" },
    ...over,
  };
}

function mockDb(overrides: Record<string, unknown> = {}) {
  const store = {
    stagedRecord: {
      findMany: vi.fn().mockResolvedValue([]),
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
      findFirst: vi.fn().mockImplementation((args: { where: { code: string } }) =>
        Promise.resolve({ id: `acct_${args.where.code}` })
      ),
    },
    transaction: { create: vi.fn().mockResolvedValue({ id: "tx_db_1" }) },
    bankAccount: {
      findFirst: vi.fn().mockResolvedValue({ id: "bank_operating" }),
    },
    bankTransaction: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "bt_db_1" }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
  return store;
}

describe("promoteStagedRecords", () => {
  beforeEach(() => vi.clearAllMocks());

  it("promotes a payment to customer + AR invoice + balanced JE", async () => {
    const db = mockDb({
      stagedRecord: {
        findMany: vi.fn().mockResolvedValue([staged({ externalId: "pay_1" })]),
        update: vi.fn().mockResolvedValue({}),
      },
    });
    const res = await promoteStagedRecords(db as never, ORG);
    expect(res).toMatchObject({ promoted: 1, rejected: 0 });
    // customer adopted by code, invoice numbered stably, USD converted
    expect(db.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: "DODO-cus_1" }) })
    );
    const invData = (db.invoice.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(invData).toMatchObject({
      type: "AR",
      status: "SENT",
      invoiceNumber: "EXT-DODO-pay_1",
      currency: "USD",
    });
    expect(invData.total).toBeCloseTo(42.8, 1);
    // balanced JE: Dr AR / Cr Revenue for the same total
    const txCalls = (db.transaction.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(txCalls).toHaveLength(2);
    const debits = txCalls.map((c) => (c[0].data.debit as number) - (c[0].data.credit as number));
    expect(debits[0] + debits[1]).toBeCloseTo(0, 6);
    expect(db.stagedRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROMOTED", promotedId: "inv_db_1" }) })
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "connector.promote" }) })
    );
  });

  it("promotes a payout to a PENDING bank leg, no invoice", async () => {
    const db = mockDb({
      stagedRecord: {
        findMany: vi.fn().mockResolvedValue([
          staged({ id: "st_po", kind: "payout", externalId: "po_1", amount: 5000, customerExternalId: null }),
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
    });
    const res = await promoteStagedRecords(db as never, ORG);
    expect(res.promoted).toBe(1);
    expect(db.invoice.create).not.toHaveBeenCalled();
    const btData = (db.bankTransaction.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(btData).toMatchObject({ source: "DODO_IMPORT", status: "PENDING" });
    expect(btData.amount).toBeCloseTo(59.59, 1); // ₹5000 @ 83.9
  });

  it("promotes a refund as a negative leg linked to its invoice", async () => {
    const db = mockDb({
      stagedRecord: {
        findMany: vi.fn().mockResolvedValue([
          staged({ id: "st_rf", kind: "refund", externalId: "rf_1", amount: 100, raw: { payment_id: "pay_9" } }),
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      invoice: {
        findFirst: vi.fn().mockResolvedValue({ id: "inv_db_9" }),
        create: vi.fn(),
      },
    });
    const res = await promoteStagedRecords(db as never, ORG);
    expect(res.promoted).toBe(1);
    const btData = (db.bankTransaction.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(btData.amount).toBeLessThan(0);
    expect(btData.invoiceId).toBe("inv_db_9");
  });

  it("promotes a subscription to a customer record only", async () => {
    const db = mockDb({
      stagedRecord: {
        findMany: vi.fn().mockResolvedValue([
          staged({ id: "st_sub", kind: "subscription", externalId: "sub_1" }),
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
    });
    const res = await promoteStagedRecords(db as never, ORG);
    expect(res.promoted).toBe(1);
    expect(db.customer.create).toHaveBeenCalled();
    expect(db.invoice.create).not.toHaveBeenCalled();
    expect(db.bankTransaction.create).not.toHaveBeenCalled();
  });

  it("rejects bad rows in isolation and rejects unknown kinds/currencies", async () => {
    const db = mockDb({
      stagedRecord: {
        findMany: vi.fn().mockResolvedValue([
          staged({ id: "st_bad1", externalId: "bad1", currency: "XXX" }),
          staged({ id: "st_bad2", kind: "mystery", externalId: "bad2" }),
          staged({ id: "st_ok", externalId: "pay_1" }),
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
    });
    const res = await promoteStagedRecords(db as never, ORG);
    expect(res).toMatchObject({ promoted: 1, rejected: 2 });
    const byId = Object.fromEntries(res.details.map((d) => [d.stagedId, d]));
    expect(byId.st_bad1.reason).toMatch(/unsupported currency/);
    expect(byId.st_bad2.reason).toMatch(/unknown staged kind/);
    const updates = (db.stagedRecord.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updates.filter((c) => c[0].data.status === "REJECTED")).toHaveLength(2);
  });

  it("adopts natural keys instead of duplicating on replay", async () => {
    const db = mockDb({
      stagedRecord: {
        findMany: vi.fn().mockResolvedValue([staged({ externalId: "pay_1" })]),
        update: vi.fn().mockResolvedValue({}),
      },
      invoice: {
        findFirst: vi.fn().mockResolvedValue({ id: "inv_existing" }),
        create: vi.fn(),
      },
    });
    const res = await promoteStagedRecords(db as never, ORG);
    expect(res.promoted).toBe(1);
    expect(db.invoice.create).not.toHaveBeenCalled();
    expect(db.journalEntry.create).not.toHaveBeenCalled();
    expect(res.details[0]).toMatchObject({ promotedId: "inv_existing" });
  });
});
