// Cash forecast, aging, and billing comparison (mocked Prisma — deterministic).
// Covers pure classifiers plus the 4 B6 tools end to registry level.

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { collectionRate } from "../lib/financial/cashForecast";
import { bucketFor as agingBucket } from "../lib/financial/aging";
import { classifyBilling } from "../lib/financial/billing";
import { executeTool } from "../lib/tools/registry";

const ctx = (db: PrismaClient) => ({ db, orgId: "org_acme_industries" });

describe("cash forecast helpers (pure)", () => {
  it("haircuts collections by overdue age", () => {
    expect(collectionRate(-5)).toBe(1);
    expect(collectionRate(0)).toBe(1);
    expect(collectionRate(20)).toBe(0.85);
    expect(collectionRate(45)).toBe(0.6);
    expect(collectionRate(120)).toBe(0.4);
  });

  it("buckets days overdue on a fixed scale", () => {
    expect([agingBucket(-10), agingBucket(0)]).toEqual(["current", "current"]);
    expect(agingBucket(15)).toBe("1-30");
    expect(agingBucket(45)).toBe("31-60");
    expect(agingBucket(75)).toBe("61-90");
    expect(agingBucket(200)).toBe("90+");
  });
});

describe("classifyBilling (pure)", () => {
  it("passes normal months and flags the leakage shapes", () => {
    expect(classifyBilling({ actual: 100, count: 2, expected: 105, usualCount: 2 }).verdict).toBe("OK");
    expect(classifyBilling({ actual: 60, count: 1, expected: 100, usualCount: 2 }).verdict).toBe("MISSING_INVOICE");
    expect(classifyBilling({ actual: 80, count: 2, expected: 100, usualCount: 2 }).verdict).toBe("UNDER_BILLING");
    expect(classifyBilling({ actual: 95, count: 3, expected: 100, usualCount: 2 }).verdict).toBe("TIMING");
    expect(classifyBilling({ actual: 130, count: 2, expected: 100, usualCount: 2 }).verdict).toBe("OVER_BILLING");
    expect(classifyBilling({ actual: 0, count: 0, expected: 0, usualCount: 0 }).verdict).toBe("OK");
    expect(classifyBilling({ actual: 50, count: 1, expected: 0, usualCount: 0 }).verdict).toBe("TIMING");
  });
});

function mockDb(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    bankAccount: {
      findMany: vi.fn().mockResolvedValue([{ id: "b1", name: "Operating", openingBalance: 1000000 }]),
    },
    bankTransaction: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    invoice: {
      findMany: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        const where = args.where as { type?: string };
        if (where.type === "AR") {
          return Promise.resolve([
            { invoiceNumber: "AR-1", total: 300000, dueDate: new Date("2025-01-10T00:00:00Z"), issueDate: new Date("2024-12-10T00:00:00Z"), customer: { name: "Big Co" } },
            { invoiceNumber: "AR-2", total: 200000, dueDate: new Date("2024-11-15T00:00:00Z"), issueDate: new Date("2024-10-15T00:00:00Z"), customer: { name: "Late Co" } },
          ]);
        }
        return Promise.resolve([
          { invoiceNumber: "AP-1", total: 900000, dueDate: new Date("2025-01-15T00:00:00Z"), issueDate: new Date("2024-12-20T00:00:00Z"), vendor: { name: "Steel Co" } },
        ]);
      }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    transaction: {
      findMany: vi.fn().mockImplementation((args: { where: { account?: { code?: string } } }) => {
        // trailing payroll postings drive the weekly run-rate; nothing else
        if (args.where?.account?.code === "6000") {
          return Promise.resolve([
            { debit: 145000, credit: 0 },
            { debit: 145000, credit: 0 },
            { debit: 145000, credit: 0 },
          ]);
        }
        return Promise.resolve([]);
      }),
    },
    customer: { findFirst: vi.fn().mockResolvedValue({ id: "c_lake", name: "Lakeside" }) },
    forecast: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  } as unknown as PrismaClient;
}

describe("cash + aging + billing tools (mocked Prisma)", () => {
  it("getCashForecast projects weeks with a floor shortfall", async () => {
    const out = (await executeTool(
      "getCashForecast",
      { orgId: "org_acme_industries", asOf: "2025-01-01T00:00:00.000Z", weeks: 13 },
      ctx(mockDb())
    )) as { weeks: Array<{ balance: number }>; shortfall: number; minBalance: number; opening: number };
    expect(out.weeks).toHaveLength(13);
    expect(out.opening).toBe(1000000);
    // 900k outflow vs ~420k haircut inflows + opex burn → floor breach
    expect(out.shortfall).toBeGreaterThan(0);
    expect(out.minBalance).toBe(out.weeks.reduce((m, w) => Math.min(m, w.balance), Infinity));
  });

  it("getArAging buckets overdue dollars deterministically", async () => {
    const out = (await executeTool(
      "getArAging", { orgId: "org_acme_industries", asOf: "2025-01-01T00:00:00.000Z" }, ctx(mockDb())
    )) as { totals: Record<string, number>; rows: Array<{ bucket: string }> };
    // AR-2 due 2024-11-15 → 47d overdue → 31-60
    expect(out.totals["31-60"]).toBe(200000);
    expect(out.totals.current).toBe(300000);
  });

  it("getApAging totals unpaid bills", async () => {
    const out = (await executeTool(
      "getApAging", { orgId: "org_acme_industries", asOf: "2025-01-01T00:00:00.000Z" }, ctx(mockDb())
    )) as { total: number };
    expect(out.total).toBe(900000);
  });

  it("compareCustomerBilling flags a missing split via trailing average", async () => {
    const lakeside = (month: number, totals: number[]) => ({
      findMany: vi.fn().mockImplementation((args: { where: { issueDate: { gte: Date } } }) => {
        const m = (args.where.issueDate.gte as Date).getUTCMonth() + 1;
        if (m === month) {
          return Promise.resolve(totals.map((t, i) => ({ total: t, invoiceNumber: `AR-x-0${i + 1}` })));
        }
        // trailing months: 2 invoices, 100 each
        return Promise.resolve([{ total: 100, invoiceNumber: "p1" }, { total: 100, invoiceNumber: "p2" }]);
      }),
    });
    const db = mockDb({ invoice: lakeside(11, [120]) });
    const out = (await executeTool(
      "compareCustomerBilling",
      { orgId: "org_acme_industries", customerId: "c_lake", year: 2024, month: 11 },
      ctx(db)
    )) as { verdict: string; actual: number; expected: number; caveat: string };
    expect(out.verdict).toBe("MISSING_INVOICE");
    expect(out.actual).toBe(120);
    expect(out.expected).toBe(200);
    expect(out.caveat).toMatch(/heuristic/);
  });

  it("compareCustomerBilling 404s unknown customers", async () => {
    const db = mockDb({ customer: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(
      executeTool("compareCustomerBilling", { orgId: "org_acme_industries", customerId: "nope", year: 2024, month: 11 }, ctx(db))
    ).rejects.toThrow(/customer not found/);
  });

  it("new tools enforce org isolation and validate ranges", async () => {
    await expect(
      executeTool("getCashForecast", { orgId: "org_attacker" }, ctx(mockDb()))
    ).rejects.toThrow(/orgId/);
    await expect(
      executeTool("getCashForecast", { orgId: "org_acme_industries", weeks: 99 }, ctx(mockDb()))
    ).rejects.toThrow();
  });
});
