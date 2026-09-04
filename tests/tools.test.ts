import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { executeTool, TOOL_NAMES } from "../lib/tools/registry";
import { aggregatePnl } from "../lib/financial/pnl";

const REV = { id: "acct_4000", code: "4000", name: "Revenue", type: "REVENUE" };
const COGS = { id: "acct_5000", code: "5000", name: "COGS — Materials", type: "COGS" };
const OPEX = { id: "acct_6000", code: "6000", name: "Opex — Payroll", type: "EXPENSE" };

function mockDb(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    transaction: {
      findMany: vi.fn().mockResolvedValue([
        { debit: 0, credit: 1_200_000, account: REV },
        { debit: 726_000, credit: 0, account: COGS },
        { debit: 179_500, credit: 0, account: OPEX },
      ]),
    },
    invoice: {
      findMany: vi.fn().mockImplementation((args: Record<string, unknown>) => {
        const where = (args?.where ?? {}) as Record<string, unknown>;
        // Vendor-spend / price queries filter by vendorId
        if (where.vendorId === "vendor_apex" && (where as { unitPrice?: unknown }).unitPrice) {
          return Promise.resolve([
            { invoiceNumber: "AP-202408-APEX-01", issueDate: new Date("2024-08-11T00:00:00Z"), quantity: 330, unitPrice: 1088, total: 359040 },
          ]);
        }
        if (where.vendorId) {
          return Promise.resolve([
            { invoiceNumber: "AP-202408-APEX-01", total: 359040, vendorId: "vendor_apex", vendor: { id: "vendor_apex", name: "Apex Steel Co", code: "APEX" } },
            { invoiceNumber: "AP-202408-GLC-01", total: 150000, vendorId: "vendor_glc", vendor: { id: "vendor_glc", name: "Great Lakes Components", code: "GLC" } },
          ]);
        }
        if (where.type === "AR") {
          return Promise.resolve([
            { invoiceNumber: "AR-202408-AUTOFAB-01", total: 200000, customer: { id: "c1", name: "AutoFab Systems" } },
          ]);
        }
        return Promise.resolve([
          { id: "inv1", invoiceNumber: "AP-202408-APEX-01", type: "AP", status: "SENT", vendor: { id: "vendor_apex", name: "Apex Steel Co", code: "APEX" }, customer: null, material: "STEEL_COIL", quantity: 330, unitPrice: 1088, subtotal: 359040, total: 359040, issueDate: new Date("2024-08-11T00:00:00Z"), dueDate: new Date("2024-09-10T00:00:00Z") },
          { id: "inv2", invoiceNumber: "AP-202408-GLC-01", type: "AP", status: "SENT", vendor: { id: "vendor_glc", name: "Great Lakes Components", code: "GLC" }, customer: null, material: "STEEL_BRACKET", quantity: 12000, unitPrice: 12.5, subtotal: 150000, total: 150000, issueDate: new Date("2024-08-12T00:00:00Z"), dueDate: new Date("2024-09-11T00:00:00Z") },
        ]);
      }),
    },
    contract: {
      findFirst: vi.fn().mockResolvedValue({
        id: "contract_apex", contractNumber: "CTR-2024-APEX", title: "Apex supply",
        material: "STEEL_COIL", unitOfMeasure: "TON", unitPrice: 850, quantity: 3960,
        totalValue: 3366000, status: "ACTIVE",
        startDate: new Date("2024-01-01T00:00:00Z"), endDate: new Date("2024-12-31T00:00:00Z"),
        vendor: { id: "vendor_apex", name: "Apex Steel Co", code: "APEX" },
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "contract_apex", contractNumber: "CTR-2024-APEX", title: "Apex supply",
          material: "STEEL_COIL", unitOfMeasure: "TON", unitPrice: 850, quantity: 3960,
          totalValue: 3366000, status: "ACTIVE",
          startDate: new Date("2024-01-01T00:00:00Z"), endDate: new Date("2024-12-31T00:00:00Z"),
          vendor: { id: "vendor_apex", name: "Apex Steel Co", code: "APEX" },
        },
      ]),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  } as unknown as PrismaClient;
}

const ctx = (db: PrismaClient) => ({ db, orgId: "org_acme_industries" });

describe("tool registry", () => {
  it("exposes exactly the 8 Phase-1 tools", () => {
    expect(TOOL_NAMES.sort()).toEqual(
      ["breakDownMetric", "calculateFinancialImpact", "comparePeriods", "compareVendorPrices", "getContract", "getInvoices", "getPnl", "getVendorSpend"].sort()
    );
  });

  it("rejects unknown tools and invalid input without touching the DB", async () => {
    const db = mockDb();
    await expect(executeTool("dropTable", {}, ctx(db))).rejects.toThrow(/unknown tool/);
    await expect(executeTool("getPnl", { orgId: "org_acme_industries", year: 2024 }, ctx(db))).rejects.toThrow(/invalid input/);
  });

  it("enforces org isolation between context and input", async () => {
    const db = mockDb();
    await expect(
      executeTool("getPnl", { orgId: "org_attacker", year: 2024, month: 8 }, ctx(db))
    ).rejects.toThrow(/orgId/);
  });
});

describe("financial tools (mocked Prisma — deterministic)", () => {
  it("getPnl aggregates revenue/cogs/opex with correct sign conventions", async () => {
    const out = (await executeTool(
      "getPnl", { orgId: "org_acme_industries", year: 2024, month: 8 }, ctx(mockDb())
    )) as { revenue: number; cogs: number; grossMargin: number };
    expect(out.revenue).toBe(1_200_000);
    expect(out.cogs).toBe(726_000);
    expect(out.grossMargin).toBeCloseTo(39.5, 1);
  });

  it("getVendorSpend totals and ranks vendors with contributions", async () => {
    const out = (await executeTool(
      "getVendorSpend",
      { orgId: "org_acme_industries", startDate: "2024-08-01T00:00:00.000Z", endDate: "2024-09-01T00:00:00.000Z" },
      ctx(mockDb())
    )) as { total: number; vendors: Array<{ vendorCode: string; contributionPercent: number }> };
    expect(out.total).toBe(509040);
    expect(out.vendors[0].vendorCode).toBe("APEX");
    expect(out.vendors[0].contributionPercent).toBeCloseTo(70.53, 1);
  });

  it("comparePeriods computes variance deterministically", async () => {
    const out = (await executeTool(
      "comparePeriods",
      { orgId: "org_acme_industries", currentYear: 2024, currentMonth: 8, previousYear: 2024, previousMonth: 7, metric: "revenue" },
      ctx(mockDb())
    )) as { variance: number };
    // identical mocked months → zero variance
    expect(out.variance).toBe(0);
  });

  it("breakDownMetric supports cogs and revenue", async () => {
    const cogs = (await executeTool(
      "breakDownMetric", { orgId: "org_acme_industries", metric: "cogs", year: 2024, month: 8 }, ctx(mockDb())
    )) as { total: number };
    expect(cogs.total).toBe(509040);
    const rev = (await executeTool(
      "breakDownMetric", { orgId: "org_acme_industries", metric: "revenue", year: 2024, month: 8 }, ctx(mockDb())
    )) as { total: number };
    expect(rev.total).toBe(200000);
  });

  it("getContract fetches by number and lists by vendor", async () => {
    const one = (await executeTool(
      "getContract", { orgId: "org_acme_industries", contractNumber: "CTR-2024-APEX" }, ctx(mockDb())
    )) as { unitPrice: number };
    expect(one.unitPrice).toBe(850);
    const many = (await executeTool(
      "getContract", { orgId: "org_acme_industries", vendorId: "vendor_apex" }, ctx(mockDb())
    )) as Array<{ contractNumber: string }>;
    expect(many[0].contractNumber).toBe("CTR-2024-APEX");
  });

  it("compareVendorPrices quantifies the overcharge with invoice evidence", async () => {
    const out = (await executeTool(
      "compareVendorPrices",
      { orgId: "org_acme_industries", vendorId: "vendor_apex", startDate: "2024-08-01T00:00:00.000Z", endDate: "2024-09-01T00:00:00.000Z" },
      ctx(mockDb())
    )) as { avgUnitPrice: number; estimatedImpact: number; invoiceCount: number };
    expect(out.avgUnitPrice).toBe(1088);
    expect(out.estimatedImpact).toBe(78540);
    expect(out.invoiceCount).toBe(1);
  });

  it("calculateFinancialImpact is pure math through the registry", async () => {
    const out = (await executeTool(
      "calculateFinancialImpact",
      { orgId: "org_acme_industries", baselineUnitPrice: 850, actualUnitPrice: 1088, quantity: 330 },
      ctx(mockDb())
    )) as { totalImpact: number };
    expect(out.totalImpact).toBe(78540);
  });

  it("aggregatePnl is order-independent (deterministic)", () => {
    const lines = [
      { debit: 726_000, credit: 0, account: COGS },
      { debit: 0, credit: 1_200_000, account: REV },
    ];
    const a = aggregatePnl("o", new Date("2024-08-01T00:00:00Z"), new Date("2024-09-01T00:00:00Z"), lines);
    const b = aggregatePnl("o", new Date("2024-08-01T00:00:00Z"), new Date("2024-09-01T00:00:00Z"), [...lines].reverse());
    expect(a).toEqual(b);
  });
});
