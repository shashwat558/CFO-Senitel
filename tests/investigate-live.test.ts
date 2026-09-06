// Live end-to-end check of the Investigator Agent loop against the seeded
// database (real Prisma + real tools; the LLM transport is a deterministic
// stand-in that merely CHOOSES tool calls and copies numbers out of tool
// results — it contains ZERO financial figures in its source).
//
// Provable claim: the answer's "August margin drop Xpp" and "Apex impact $Y"
// come from tool outputs, not hardcoded strings. The fake LLM records the
// values it read from tool messages; the test re-runs the same tools fresh
// and asserts the answer matches them, then verifies the run persisted an
// AgentRun (COMPLETED), AgentStep rows, and IncidentEvidence rows.
//
// Skips when PostgreSQL is unreachable (CI-friendly). When the DB is
// reachable but unseeded, the suite fails loudly: run `npx prisma db seed`.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/db/prisma";
import type { InvestigatorClient } from "../lib/ai/investigator-client";
import { runInvestigatorLoop } from "../lib/agent/investigator-loop";
import { executeAgentTool } from "../lib/tools/openai";
import type { ToolContext } from "../lib/tools/types";

const ORG_ID = "org_acme_industries";
const INCIDENT_ID = "incident_gm_aug2024";

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = await dbReachable();

interface ComparePeriodsData {
  variance: number;
  current: number;
  previous: number;
}

interface CompareVendorPricesData {
  avgUnitPrice: number;
  totalQuantity: number;
  estimatedImpact: number;
  contract: { unitPrice: number };
}

interface Observed {
  toolNames: string[];
  comparePeriods?: ComparePeriodsData;
  compareVendorPrices?: CompareVendorPricesData;
  calculateFinancialImpact?: { totalImpact: number };
  summary?: string;
}

/** Deterministic LLM stand-in running the README's canonical path:
 * getPnl → comparePeriods → breakDownMetric → getVendorSpend →
 * compareVendorPrices → calculateFinancialImpact → done. Every number in its
 * final summary is read from the tool messages at runtime. */
function liveInvestigatorLlm() {
  const observed: Observed = { toolNames: [] };

  const tool = (id: string, name: string, args: Record<string, unknown>) => ({
    id,
    name,
    arguments: JSON.stringify(args),
    parsedArgs: args,
  });

  const plan = {
    content: {
      objective: "Explain why August 2024 gross margin fell vs July 2024",
      period: "2024-08",
      metric: "gross_margin",
      knownFacts: ["August gross margin is below July"],
      unknowns: ["whether revenue or COGS moved", "which vendor drove COGS"],
      initialPlan: [
        "get baseline P&L for August and July",
        "break down COGS by vendor",
        "compare vendor prices vs contract",
        "quantify the impact",
      ],
    },
    toolCalls: [],
    finishReason: "stop",
    usage: null,
    model: "fake-llm",
  };

  const llm = {
    continueConversation: vi.fn(
      async (req: {
        messages: Array<{ role: string; name?: string; content?: string }>;
        responseSchema?: { name: string };
      }) => {
        if (req.responseSchema?.name === "investigation_plan") return plan;

        const toolMsgs = req.messages.filter((m) => m.role === "tool");
        observed.toolNames = toolMsgs.map((m) => m.name!).filter(Boolean);
        const doneTools = toolMsgs.length;

        const toolData = (name: string) => {
          const m = [...req.messages].reverse().find((x) => x.role === "tool" && x.name === name);
          if (!m?.content) return null;
          const parsed = JSON.parse(m.content) as { ok: boolean; data?: unknown };
          return parsed.ok ? parsed.data : null;
        };

        const augWindow = { startDate: "2024-08-01T00:00:00.000Z", endDate: "2024-09-01T00:00:00.000Z" };

        switch (doneTools) {
          case 0:
            return {
              content: { thinking: "baseline P&L first", done: false },
              toolCalls: [tool("c1", "getPnl", { orgId: ORG_ID, year: 2024, month: 8 })],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          case 1:
            return {
              content: { thinking: "quantify the margin move vs July", done: false },
              toolCalls: [tool("c2", "comparePeriods", {
                orgId: ORG_ID, currentYear: 2024, currentMonth: 8,
                previousYear: 2024, previousMonth: 7, metric: "grossMargin",
              })],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          case 2:
            return {
              content: { thinking: "find which COGS vendor moved", done: false },
              toolCalls: [tool("c3", "breakDownMetric", { orgId: ORG_ID, metric: "cogs", year: 2024, month: 8 })],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          case 3:
            return {
              content: { thinking: "vendor spend ranks the suppliers", done: false },
              toolCalls: [tool("c4", "getVendorSpend", { orgId: ORG_ID, ...augWindow })],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          case 4:
            return {
              content: { thinking: "compare Apex invoiced price vs contract", done: false },
              toolCalls: [tool("c5", "compareVendorPrices", {
                orgId: ORG_ID, vendorId: "vendor_apex", ...augWindow,
              })],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          case 5: {
            const cvp = toolData("compareVendorPrices") as CompareVendorPricesData | null;
            if (!cvp) throw new Error("fake LLM lost compareVendorPrices result");
            return {
              content: { thinking: "confirm the dollar impact", done: false },
              toolCalls: [tool("c6", "calculateFinancialImpact", {
                orgId: ORG_ID,
                baselineUnitPrice: cvp.contract.unitPrice,
                actualUnitPrice: cvp.avgUnitPrice,
                quantity: cvp.totalQuantity,
              })],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          }
          default: {
            // Evidence is complete — build the final summary ONLY from the
            // numbers the tools actually returned. No literals here.
            const cp = toolData("comparePeriods") as ComparePeriodsData | null;
            const cvp = toolData("compareVendorPrices") as CompareVendorPricesData | null;
            const calc = toolData("calculateFinancialImpact") as { totalImpact: number } | null;
            if (!cp || !cvp || !calc) throw new Error("fake LLM missing tool results for summary");
            observed.comparePeriods = cp;
            observed.compareVendorPrices = cvp;
            observed.calculateFinancialImpact = calc;
            const dropPp = Math.abs(cp.variance);
            const summary =
              `August gross margin fell ${dropPp.toFixed(1)}pp vs July ` +
              `(${cp.previous.toFixed(1)}% → ${cp.current.toFixed(1)}%); ` +
              `Apex Steel overcharge impact ≈ $${Math.round(calc.totalImpact).toFixed(0)} ` +
              `on ${cvp.totalQuantity} units (invoiced avg $${Math.round(cvp.avgUnitPrice).toFixed(0)} ` +
              `vs contract $${cvp.contract.unitPrice}).`;
            observed.summary = summary;
            return {
              content: { thinking: "evidence answers the question", done: true, summary },
              toolCalls: [],
              finishReason: "stop", usage: null, model: "fake-llm",
            };
          }
        }
      }
    ),
  } as unknown as InvestigatorClient;

  return { llm, observed };
}

describe.skipIf(!dbAvailable)("live investigator loop against the seeded database", () => {
  let ctx: ToolContext;

  beforeAll(async () => {
    const org = await prisma.organization.findUnique({ where: { slug: "acme-industries" } });
    const incident = await prisma.financialIncident.findUnique({ where: { id: INCIDENT_ID } });
    if (!org || !incident) {
      throw new Error("live DB is reachable but unseeded — run `npx prisma db seed` before this test");
    }
    if (org.id !== ORG_ID || incident.orgId !== ORG_ID) {
      throw new Error(`live DB seed mismatch: expected org ${ORG_ID}, found ${org.id}/${incident.orgId}`);
    }
    ctx = { db: prisma, orgId: ORG_ID };
  });

  beforeEach(async () => {
    // Wipe prior AgentRun/Step rows + this incident's evidence so the delta
    // assertions measure exactly this run (evidence/steps accumulate).
    await prisma.agentStep.deleteMany({ where: { run: { incidentId: INCIDENT_ID } } });
    await prisma.agentRun.deleteMany({ where: { incidentId: INCIDENT_ID } });
    await prisma.incidentEvidence.deleteMany({ where: { incidentId: INCIDENT_ID } });
  });

  it("answers why margin fell from tool-derived numbers and persists the run/steps/evidence", async () => {
    const { llm, observed } = liveInvestigatorLlm();

    const res = await runInvestigatorLoop({
      db: prisma,
      llm,
      toolCtx: ctx,
      orgId: ORG_ID,
      incidentId: INCIDENT_ID,
      question: "Why did gross margin fall in August?",
      maxIterations: 10,
    });

    // --- the loop completed and executed the canonical tool chain ---
    expect(res.status).toBe("COMPLETED");
    expect(res.toolCallsExecuted).toBe(6);
    expect(observed.toolNames).toEqual([
      "getPnl", "comparePeriods", "breakDownMetric", "getVendorSpend", "compareVendorPrices", "calculateFinancialImpact",
    ]);
    expect(observed.comparePeriods).toBeDefined();

    // --- persisted rows: AgentRun (COMPLETED) + AgentStep + IncidentEvidence ---
    const runRow = await prisma.agentRun.findUnique({ where: { id: res.runId } });
    expect(runRow?.status).toBe("COMPLETED");
    expect(runRow?.orgId).toBe(ORG_ID);
    expect(runRow?.incidentId).toBe(INCIDENT_ID);
    expect((runRow?.input as { question?: string } | null)?.question).toContain("gross margin");

    const steps = await prisma.agentStep.findMany({ where: { runId: res.runId }, orderBy: { seq: "asc" } });
    expect(steps.length).toBeGreaterThanOrEqual(7); // plan + 6 tool executions (+ LLM turns)
    const toolSteps = steps.map((s) => s.toolName).filter(Boolean);
    expect(toolSteps).toEqual(observed.toolNames);

    const evidenceRows = await prisma.incidentEvidence.findMany({ where: { incidentId: INCIDENT_ID } });
    expect(evidenceRows.length).toBeGreaterThanOrEqual(6); // one row per tool execution
    expect(evidenceRows.map((e) => e.toolName).sort()).toEqual(observed.toolNames.slice().sort());

    // --- numbers come from tools, not strings ---
    const summary = (res.answer as { summary?: string } | null)?.summary ?? "";
    expect(observed.summary).toBe(summary);
    expect(summary).toContain("gross margin");

    // Re-run the same tools fresh; the answer's figures must match them.
    const periods = await executeAgentTool("comparePeriods", {
      orgId: ORG_ID, currentYear: 2024, currentMonth: 8,
      previousYear: 2024, previousMonth: 7, metric: "grossMargin",
    }, ctx);
    expect(periods.ok).toBe(true);
    const cvp = await executeAgentTool("compareVendorPrices", {
      orgId: ORG_ID, vendorId: "vendor_apex",
      startDate: "2024-08-01T00:00:00.000Z", endDate: "2024-09-01T00:00:00.000Z",
    }, ctx);
    expect(cvp.ok).toBe(true);

    const freshDrop = Math.abs((periods as { data: { variance: number } }).data.variance);
    const freshImpact = (cvp as { data: { estimatedImpact: number } }).data.estimatedImpact;
    expect(freshDrop).toBeGreaterThan(4); // the seed guarantees ≥4pp drop
    expect(freshImpact).toBeGreaterThan(0);

    // the fake observed exactly what the tools returned…
    expect(Math.abs(observed.comparePeriods!.variance)).toBeCloseTo(freshDrop, 6);
    expect(observed.compareVendorPrices!.estimatedImpact).toBe(freshImpact);
    expect(observed.calculateFinancialImpact!.totalImpact)
      .toBe(observed.compareVendorPrices!.estimatedImpact);

    // …and the answer text embeds them (drop in pp + impact in $).
    expect(summary).toContain(`fell ${freshDrop.toFixed(1)}pp`);
    expect(summary).toContain(`impact ≈ $${freshImpact.toFixed(0)}`);
  });
});