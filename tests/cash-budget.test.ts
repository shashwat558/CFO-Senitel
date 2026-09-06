// Cash + budget services and tools (mocked Prisma — deterministic).
// Covers computeBankBalances (pure), budgetVsActual, and the 5 B4 tools:
// getBankTransactions, getBankBalance, getBudgetVsActual, getForecast,
// reconcileBankTransaction.

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { computeBankBalances } from "../lib/financial/cash";
import { executeTool } from "../lib/tools/registry";

const ctx = (db: PrismaClient) => ({ db, orgId: "org_acme_industries" });

const ACCOUNTS = [
  { id: "bank_operating", name: "Operating Checking", openingBalance: 850000 },
  { id: "bank_payroll", name: "Payroll Account", openingBalance: 200000 },
];

function mockDb(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    bankAccount: { findMany: vi.fn().mockResolvedValue(ACCOUNTS) },
    bankTransaction: {
      findMany: vi.fn().mockResolvedValue([
        { id: "bt_1", bankAccountId: "bank_operating", date: new Date("2024-08-11T00:00:00Z"), description: "Collection", amount: 100000, status: "RECONCILED", invoiceId: "inv_1" },
        { id: "bt_2", bankAccountId: "bank_operating", date: new Date("2024-08-12T00:00:00Z"), description: "Payment", amount: -40000, status: "PENDING", invoiceId: null },
      ]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation((args: { data: unknown }) => Promise.resolve({ id: "bt_2", amount: -40000, ... (args.data as Record<string, unknown>) })),
    },
    budget: {
      findMany: vi.fn().mockResolvedValue([
        { account: { code: "5000", name: "COGS — Materials", type: "COGS" }, amount: 700000 },
        { account: { code: "6000", name: "Opex — Payroll", type: "EXPENSE" }, amount: 145000 },
      ]),
    },
    forecast: {
      findFirst: vi.fn().mockResolvedValue({ id: "fc_1", metric: "REVENUE", year: 2024, month: 8, scenario: "BASE", amount: 1240000 }),
    },
    transaction: {
      findMany: vi.fn().mockResolvedValue([
        { debit: 750000, credit: 0, account: { id: "a5", code: "5000", name: "COGS — Materials", type: "COGS" } },
        { debit: 145000, credit: 0, account: { id: "a6", code: "6000", name: "Opex — Payroll", type: "EXPENSE" } },
      ]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    invoice: { findFirst: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  } as unknown as PrismaClient;
}

describe("computeBankBalances (pure)", () => {
  it("sums opening + inflows − outflows, rounded once", () => {
    const { rows, total } = computeBankBalances(ACCOUNTS, [
      { bankAccountId: "bank_operating", date: new Date("2024-08-11T00:00:00Z"), amount: 100000 },
      { bankAccountId: "bank_operating", date: new Date("2024-08-12T00:00:00Z"), amount: -40000 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.bankAccountId === "bank_operating")).toMatchObject({
      opening: 850000, inflow: 100000, outflow: 40000, balance: 910000,
    });
    expect(total).toBe(1110000);
  });

  it("excludes legs after asOf and throws on corrupt amounts", () => {
    const { total } = computeBankBalances(ACCOUNTS, [
      { bankAccountId: "bank_operating", date: new Date("2024-09-01T00:00:00Z"), amount: 999 },
    ], new Date("2024-08-01T00:00:00Z"));
    expect(total).toBe(1050000);
    expect(() =>
      computeBankBalances(ACCOUNTS, [{ bankAccountId: "bank_operating", date: new Date(), amount: "xx" }])
    ).toThrow(/invalid bank amount/);
  });
});

describe("cash + budget tools (mocked Prisma)", () => {
  it("getBankBalance aggregates per account with a total", async () => {
    const out = (await executeTool("getBankBalance", { orgId: "org_acme_industries" }, ctx(mockDb()))) as {
      total: number; rows: Array<{ balance: number }>;
    };
    expect(out.total).toBe(1110000);
    expect(out.rows).toHaveLength(2);
  });

  it("getBankTransactions serializes legs and caps at limit", async () => {
    const out = (await executeTool(
      "getBankTransactions", { orgId: "org_acme_industries", status: "PENDING", limit: 1 }, ctx(mockDb())
    )) as Array<{ amount: number }>;
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(100000);
  });

  it("getBudgetVsActual joins budgets to posted actuals", async () => {
    const out = (await executeTool(
      "getBudgetVsActual", { orgId: "org_acme_industries", year: 2024, month: 8 }, ctx(mockDb())
    )) as { rows: Array<{ accountCode: string; budgeted: number; actual: number; variance: number }> };
    const cogs = out.rows.find((r) => r.accountCode === "5000")!;
    expect(cogs).toMatchObject({ budgeted: 700000, actual: 750000, variance: 50000 });
  });

  it("getForecast reads one figure and 404s when missing", async () => {
    const db = mockDb();
    const out = (await executeTool(
      "getForecast", { orgId: "org_acme_industries", metric: "REVENUE", year: 2024, month: 8 }, ctx(db)
    )) as { amount: number };
    expect(out.amount).toBe(1240000);

    const empty = mockDb({ forecast: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(
      executeTool("getForecast", { orgId: "org_acme_industries", metric: "COGS", year: 2024, month: 8 }, ctx(empty))
    ).rejects.toThrow(/no BASE forecast/);
  });

  it("reconcileBankTransaction checks cents + direction, then links", async () => {
    const db = mockDb({
      bankTransaction: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: "bt_2", status: "PENDING", amount: -40000 }),
        update: vi.fn().mockResolvedValue({ id: "bt_2", status: "RECONCILED", amount: -40000 }),
      },
      invoice: {
        findFirst: vi.fn().mockResolvedValue({ id: "inv_ap", type: "AP", total: 40000 }),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: "tx_9" }),
      },
    });
    const out = (await executeTool(
      "reconcileBankTransaction",
      { orgId: "org_acme_industries", bankTransactionId: "bt_2", invoiceId: "inv_ap" },
      ctx(db)
    )) as { status: string; glTransactionId: string };
    expect(out.status).toBe("RECONCILED");
    expect(out.glTransactionId).toBe("tx_9");
  });

  it("reconcileBankTransaction rejects mismatches and double-reconcile", async () => {
    const pending = (amount: number) => mockDb({
      bankTransaction: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: "bt_x", status: "PENDING", amount }),
        update: vi.fn(),
      },
    });
    // wrong cents
    const wrongCents = pending(-40000);
    (wrongCents.invoice as { findFirst: unknown }).findFirst = vi.fn().mockResolvedValue({ id: "i", type: "AP", total: 40001 });
    await expect(
      executeTool("reconcileBankTransaction", { orgId: "org_acme_industries", bankTransactionId: "bt_x", invoiceId: "i" }, ctx(wrongCents))
    ).rejects.toThrow(/does not match invoice total/);
    // wrong direction (AR invoice vs outflow leg)
    const wrongDir = pending(-40000);
    (wrongDir.invoice as { findFirst: unknown }).findFirst = vi.fn().mockResolvedValue({ id: "i", type: "AR", total: 40000 });
    await expect(
      executeTool("reconcileBankTransaction", { orgId: "org_acme_industries", bankTransactionId: "bt_x", invoiceId: "i" }, ctx(wrongDir))
    ).rejects.toThrow(/requires a positive/);
    // already reconciled
    const done = mockDb({
      bankTransaction: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: "bt_x", status: "RECONCILED", amount: 1 }),
        update: vi.fn(),
      },
    });
    await expect(
      executeTool("reconcileBankTransaction", { orgId: "org_acme_industries", bankTransactionId: "bt_x" }, ctx(done))
    ).rejects.toThrow(/already reconciled/);
  });

  it("new tools enforce org isolation", async () => {
    await expect(
      executeTool("getBankBalance", { orgId: "org_attacker" }, ctx(mockDb()))
    ).rejects.toThrow(/orgId/);
  });
});
