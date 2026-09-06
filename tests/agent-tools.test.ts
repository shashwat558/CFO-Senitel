import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { executeAgentTool, getOpenAITools, toOpenAITool } from "../lib/tools/openai";
import { TOOL_NAMES } from "../lib/tools/registry";

function mockDb(): PrismaClient {
  return {
    transaction: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    invoice: { findMany: vi.fn().mockResolvedValue([]) },
    contract: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaClient;
}

const EXPECTED = [
  "getPnl",
  "getVendorSpend",
  "comparePeriods",
  "breakDownMetric",
  "getContract",
  "getInvoices",
  "compareVendorPrices",
  "calculateFinancialImpact",
  "getBankTransactions",
  "getBankBalance",
  "getBudgetVsActual",
  "getForecast",
  "reconcileBankTransaction",
  "getCashForecast",
  "getArAging",
  "getApAging",
  "compareCustomerBilling",
];

describe("agent-compatible tool adapter", () => {
  it("exposes LLM-compatible schemas for all registered tools", () => {
    expect(TOOL_NAMES.sort()).toEqual(EXPECTED.sort());
    const tools = getOpenAITools();
    expect(tools).toHaveLength(17);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(EXPECTED).toContain(t.function.name);
      expect(t.function.description!.length).toBeGreaterThan(10);
      const params = t.function.parameters as { type: string; properties: Record<string, unknown>; required: string[] };
      expect(params.type).toBe("object");
      expect(params.properties.orgId).toBeDefined();
      expect(params.required).toContain("orgId");
    }
  });

  it("carries tool-specific schema detail (enums, formats)", () => {
    const breakdown = toOpenAITool("breakDownMetric");
    const props = (breakdown.function.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.metric.enum).toEqual(["cogs", "revenue", "opex"]);
    const pnl = toOpenAITool("getPnl");
    const pnlProps = (pnl.function.parameters as { properties: Record<string, { format?: string }> }).properties;
    expect(pnlProps.startDate.format).toBe("date-time");
  });

  it("rejects unknown tools with a structured error + audit", async () => {
    const db = mockDb();
    const res = await executeAgentTool("dropTable", "{}", { db, orgId: "org1" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNKNOWN_TOOL");
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it("rejects malformed JSON arguments", async () => {
    const db = mockDb();
    const res = await executeAgentTool("getPnl", "{not json", { db, orgId: "org1" });
    expect(res).toMatchObject({ ok: false, tool: "getPnl", code: "BAD_JSON" });
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it("rejects invalid arguments (Zod) with structured error + audit, no DB touch", async () => {
    const db = mockDb();
    const res = await executeAgentTool(
      "getPnl",
      JSON.stringify({ orgId: "org1", year: 2024 }), // month missing -> refine fails
      { db, orgId: "org1" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
    expect(db.transaction.findMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it("runs the existing tool and returns structured, JSON-safe results + audits success", async () => {
    const db = mockDb();
    const res = await executeAgentTool(
      "calculateFinancialImpact",
      JSON.stringify({ orgId: "org1", baselineUnitPrice: 850, actualUnitPrice: 1088, quantity: 330 }),
      { db, orgId: "org1" },
    );
    expect(res).toMatchObject({ ok: true, tool: "calculateFinancialImpact", data: { totalImpact: 78540 } });
    // JSON round-trip safe
    expect(() => JSON.stringify((res as { data: unknown }).data)).not.toThrow();
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it("accepts pre-parsed objects as well as JSON strings", async () => {
    const db = mockDb();
    const res = await executeAgentTool(
      "calculateFinancialImpact",
      { orgId: "org1", baselineUnitPrice: 100, actualUnitPrice: 110, quantity: 5 },
      { db, orgId: "org1" },
    );
    expect(res).toMatchObject({ ok: true, data: { totalImpact: 50 } });
  });
});
