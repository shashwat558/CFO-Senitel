// Live B6 proof against the seeded database (real Prisma + real tools; the
// LLM transport is a deterministic stand-in that merely CHOOSES tool calls
// and copies numbers out of tool results — ZERO financial figures in source).
//
// Cash: getCashForecast → getArAging → getApAging → done. The answer's
// shortfall comes from the tool output; the test re-runs getCashForecast
// fresh and asserts equality.
// Leakage: compareCustomerBilling (LAKESIDE Nov + NORTHSTAR Dec) → done.
// Verdicts come from tools; the test re-runs both fresh and asserts equality.
//
// Skips when PostgreSQL is unreachable (CI-friendly); fails loudly when the
// DB is reachable but unseeded.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/db/prisma";
import type { InvestigatorClient } from "../lib/ai/investigator-client";
import { runInvestigatorLoop } from "../lib/agent/investigator-loop";
import { executeAgentTool } from "../lib/tools/openai";
import type { ToolContext } from "../lib/tools/types";

const ORG_ID = "org_acme_industries";
const CASH_INCIDENT = "incident_cash_q1_2025";
const LEAK_INCIDENT = "incident_leakage_nov2024";

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = await dbReachable();

interface CashData {
  shortfall: number;
  minBalance: number;
  drivers: Array<{ label: string; amount: number }>;
}

interface BillingData {
  verdict: string;
  actual: number;
  expected: number;
  variancePercent: number;
}

const tool = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  name,
  arguments: JSON.stringify(args),
  parsedArgs: args,
});

const planFor = (objective: string, initialPlan: string[]) => ({
  content: {
    objective,
    period: "2025-Q1",
    metric: "cash",
    knownFacts: [],
    unknowns: ["what the tools say"],
    initialPlan,
  },
  toolCalls: [],
  finishReason: "stop",
  usage: null,
  model: "fake-llm",
});

function toolData(messages: Array<{ role: string; name?: string; content?: string }>, name: string) {
  const m = [...messages].reverse().find((x) => x.role === "tool" && x.name === name);
  if (!m?.content) return null;
  const parsed = JSON.parse(m.content) as { ok: boolean; data?: unknown };
  return parsed.ok ? parsed.data : null;
}

/** Cash path: forecast → AR aging → AP aging → done. */
function cashLlm(observed: { toolNames: string[]; forecast?: CashData; summary?: string }) {
  return {
    continueConversation: vi.fn(
      async (req: {
        messages: Array<{ role: string; name?: string; content?: string }>;
        responseSchema?: { name: string };
      }) => {
        if (req.responseSchema?.name === "investigation_plan") {
          return planFor("Will we breach minimum cash in the next 13 weeks?", [
            "project 13-week cash",
            "age receivables and payables",
          ]);
        }
        const doneTools = req.messages.filter((m) => m.role === "tool").length;
        switch (doneTools) {
          case 0:
            return {
              content: { thinking: "project cash first", done: false },
              toolCalls: [tool("c1", "getCashForecast", { orgId: ORG_ID })],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          case 1:
            return {
              content: { thinking: "who owes us", done: false },
              toolCalls: [tool("c2", "getArAging", { orgId: ORG_ID })],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          case 2:
            return {
              content: { thinking: "what do we owe", done: false },
              toolCalls: [tool("c3", "getApAging", { orgId: ORG_ID })],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          default: {
            const fc = toolData(req.messages, "getCashForecast") as CashData | null;
            if (!fc) throw new Error("fake LLM lost getCashForecast result");
            observed.toolNames = req.messages.map((m) => m.name!).filter(Boolean);
            observed.forecast = fc;
            const summary =
              `13-week minimum $${Math.round(fc.minBalance).toFixed(0)} with ` +
              `shortfall $${Math.round(fc.shortfall).toFixed(0)}; top driver ` +
              `${fc.drivers[0]?.label ?? "none"}.`;
            observed.summary = summary;
            return {
              content: { thinking: "forecast answers it", done: true, summary },
              toolCalls: [],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          }
        }
      }
    ),
  } as unknown as InvestigatorClient;
}

/** Leakage path: LAKESIDE Nov, then NORTHSTAR Dec as control → done. */
function leakLlm(observed: {
  toolNames: string[];
  lakeside?: BillingData;
  northstar?: BillingData;
  summary?: string;
}) {
  return {
    continueConversation: vi.fn(
      async (req: {
        messages: Array<{ role: string; name?: string; content?: string }>;
        responseSchema?: { name: string };
      }) => {
        if (req.responseSchema?.name === "investigation_plan") {
          return planFor("Is LAKESIDE November billing complete?", [
            "compare LAKESIDE November vs trailing",
            "control against NORTHSTAR December",
          ]);
        }
        const lake = { orgId: ORG_ID, customerId: "customer_lakeside", year: 2024, month: 11 };
        const north = { orgId: ORG_ID, customerId: "customer_northstar", year: 2024, month: 12 };
        const doneTools = req.messages.filter((m) => m.role === "tool").length;
        switch (doneTools) {
          case 0:
            return {
              content: { thinking: "check the suspect month", done: false },
              toolCalls: [tool("c1", "compareCustomerBilling", lake)],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          case 1:
            return {
              content: { thinking: "control case", done: false },
              toolCalls: [tool("c2", "compareCustomerBilling", north)],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          default: {
            // The loop replays full history each turn; the two billing
            // results are the first two compareCustomerBilling tool messages.
            const msgs = req.messages;
            const all = msgs.filter((m) => m.role === "tool" && m.name === "compareCustomerBilling");
            const parse = (m: { content?: string }) => {
              const parsed = JSON.parse(m.content!) as { ok: boolean; data?: unknown };
              return parsed.data as BillingData;
            };
            if (all.length < 2) throw new Error("fake LLM lost billing results");
            const lakeside = parse(all[0]);
            const northstar = parse(all[1]);
            if (!lakeside || !northstar) throw new Error("fake LLM lost billing results");
            observed.toolNames = ["compareCustomerBilling", "compareCustomerBilling"];
            observed.lakeside = lakeside;
            observed.northstar = northstar;
            const summary =
              `LAKESIDE November: ${lakeside.verdict} ` +
              `(${lakeside.variancePercent.toFixed(1)}%); NORTHSTAR December: ` +
              `${northstar.verdict} (${northstar.variancePercent.toFixed(1)}%).`;
            observed.summary = summary;
            return {
              content: { thinking: "billing comparison answers it", done: true, summary },
              toolCalls: [],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          }
        }
      }
    ),
  } as unknown as InvestigatorClient;
}

describe.skipIf(!dbAvailable)("live B6 investigations against the seeded database", () => {
  let ctx: ToolContext;

  beforeAll(async () => {
    const org = await prisma.organization.findUnique({ where: { slug: "acme-industries" } });
    const cash = await prisma.financialIncident.findUnique({ where: { id: CASH_INCIDENT } });
    const leak = await prisma.financialIncident.findUnique({ where: { id: LEAK_INCIDENT } });
    if (!org || !cash || !leak) {
      throw new Error("live DB is reachable but unseeded — run `npx prisma db seed` before this test");
    }
    ctx = { db: prisma, orgId: ORG_ID };
  });

  beforeEach(async () => {
    await prisma.agentStep.deleteMany({
      where: { run: { incidentId: { in: [CASH_INCIDENT, LEAK_INCIDENT] } } },
    });
    await prisma.agentRun.deleteMany({
      where: { incidentId: { in: [CASH_INCIDENT, LEAK_INCIDENT] } },
    });
    await prisma.incidentEvidence.deleteMany({
      where: { incidentId: { in: [CASH_INCIDENT, LEAK_INCIDENT] } },
    });
  });

  it("answers the cash-breach question from tool-derived numbers", async () => {
    const observed: { toolNames: string[]; forecast?: CashData; summary?: string } = { toolNames: [] };
    const res = await runInvestigatorLoop({
      db: prisma,
      llm: cashLlm(observed),
      toolCtx: ctx,
      orgId: ORG_ID,
      incidentId: CASH_INCIDENT,
      question: "Will we breach minimum cash in the next 13 weeks?",
      maxIterations: 8,
    });
    expect(res.status).toBe("COMPLETED");
    expect(res.toolCallsExecuted).toBe(3);
    expect(observed.forecast).toBeDefined();

    const fresh = await executeAgentTool("getCashForecast", { orgId: ORG_ID }, ctx);
    expect(fresh.ok).toBe(true);
    const freshData = (fresh as { data: CashData }).data;
    expect(freshData.shortfall).toBeGreaterThan(0); // the seed guarantees a breach
    expect(observed.forecast!.shortfall).toBe(freshData.shortfall);
    expect(observed.forecast!.minBalance).toBe(freshData.minBalance);
    expect(observed.summary).toContain(`shortfall $${Math.round(freshData.shortfall).toFixed(0)}`);

    const steps = await prisma.agentStep.findMany({
      where: { runId: res.runId },
      orderBy: { seq: "asc" },
    });
    expect(steps.map((s) => s.toolName).filter(Boolean)).toEqual(observed.toolNames);
  }, 60000);

  it("answers the leakage question with verdicts from tools", async () => {
    const observed: {
      toolNames: string[];
      lakeside?: BillingData;
      northstar?: BillingData;
      summary?: string;
    } = { toolNames: [] };
    const res = await runInvestigatorLoop({
      db: prisma,
      llm: leakLlm(observed),
      toolCtx: ctx,
      orgId: ORG_ID,
      incidentId: LEAK_INCIDENT,
      question: "Is LAKESIDE November billing complete?",
      maxIterations: 8,
    });
    expect(res.status).toBe("COMPLETED");
    expect(res.toolCallsExecuted).toBe(2);
    expect(observed.lakeside?.verdict).toBe("MISSING_INVOICE");
    expect(observed.northstar?.verdict).toBe("TIMING");

    for (const [customerId, year, month, verdict] of [
      ["customer_lakeside", 2024, 11, "MISSING_INVOICE"],
      ["customer_northstar", 2024, 12, "TIMING"],
    ] as const) {
      const fresh = await executeAgentTool(
        "compareCustomerBilling",
        { orgId: ORG_ID, customerId, year, month },
        ctx
      );
      expect(fresh.ok).toBe(true);
      expect((fresh as { data: BillingData }).data.verdict).toBe(verdict);
    }
    const got = (await executeAgentTool(
      "compareCustomerBilling",
      { orgId: ORG_ID, customerId: "customer_lakeside", year: 2024, month: 11 },
      ctx
    )) as { data: BillingData };
    expect(observed.lakeside!.variancePercent).toBe(got.data.variancePercent);
  }, 60000);
});
