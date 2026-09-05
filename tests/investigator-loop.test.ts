import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { InvestigatorError, type InvestigatorClient } from "../lib/ai/investigator-client";
import { runInvestigatorLoop } from "../lib/agent/investigator-loop";

function mockDb() {
  return {
    agentRun: {
      create: vi.fn().mockResolvedValue({ id: "run_1" }),
      update: vi.fn().mockResolvedValue({}),
    },
    agentStep: { create: vi.fn().mockResolvedValue({}) },
    incidentEvidence: { create: vi.fn().mockResolvedValue({}) },
    incidentFinding: {
      create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ id: "finding_1", ...args.data })),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaClient;
}

const toolCtxFor = (db: PrismaClient) => ({ db, orgId: "org1" });

type Turn = { content: unknown; toolCalls?: Array<{ id: string; name: string; args: unknown }> };

const PLAN = {
  objective: "Explain the August gross margin decline",
  period: "2024-08",
  metric: "gross_margin",
  knownFacts: ["margin fell in August"],
  unknowns: ["whether COGS or revenue moved"],
  initialPlan: ["get baseline P&L", "follow the evidence"],
};

function fakeLlm(turns: Turn[], plan: unknown = PLAN) {
  const seenMessages: unknown[][] = [];
  const seenSchemas: string[] = [];
  let i = 0;
  const llm = {
    continueConversation: vi.fn(async (req: { messages: unknown[]; responseSchema: { name: string } }) => {
      seenMessages.push(req.messages);
      seenSchemas.push(req.responseSchema.name);
      if (i === 0) {
        i += 1;
        return { content: plan, toolCalls: [], finishReason: "stop", usage: null, model: "fake" };
      }
      const turn = turns[Math.min(i - 1, turns.length - 1)];
      i += 1;
      return {
        content: turn.content,
        toolCalls: (turn.toolCalls ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          arguments: typeof t.args === "string" ? t.args : JSON.stringify(t.args),
          parsedArgs: typeof t.args === "string" ? null : t.args,
        })),
        finishReason: "stop",
        usage: null,
        model: "fake",
      };
    }),
  } as unknown as InvestigatorClient;
  return { llm, seenMessages, seenSchemas };
}

const impactArgs = { orgId: "org1", baselineUnitPrice: 850, actualUnitPrice: 1088, quantity: 330 };

describe("investigator tool loop", () => {
  it("frames a plan first, then calls multiple tools sequentially before answering", async () => {
    const db = mockDb();
    const { llm, seenMessages, seenSchemas } = fakeLlm([
      { content: { thinking: "baseline first", done: false }, toolCalls: [{ id: "c1", name: "calculateFinancialImpact", args: impactArgs }] },
      { content: { thinking: "dig deeper", done: false }, toolCalls: [{ id: "c2", name: "calculateFinancialImpact", args: impactArgs }] },
      { content: { thinking: "done", done: true, summary: "Overcharge of 78540 explains the decline." } },
    ]);
    const res = await runInvestigatorLoop({
      db,
      llm,
      toolCtx: toolCtxFor(db),
      orgId: "org1",
      incidentId: "inc1",
      question: "Why did gross margin fall in August?",
    });
    expect(res.status).toBe("COMPLETED");
    expect(res.toolCallsExecuted).toBe(2);
    expect(res.iterations).toBe(3);
    expect(res.plan).toMatchObject({ objective: expect.stringContaining("August"), metric: "gross_margin" });
    expect(res.answer).toMatchObject({ summary: expect.stringContaining("78540") });
    // plan framing used the plan schema with no tools, then deliberation turns
    expect(seenSchemas[0]).toBe("investigation_plan");
    expect(seenSchemas.slice(1).every((s) => s === "investigation_deliberation")).toBe(true);
    // every step persisted: 1 plan + 3 llm turns + 2 tool executions
    expect(db.agentStep.create).toHaveBeenCalledTimes(6);
    expect(db.incidentEvidence.create).toHaveBeenCalledTimes(2);
    expect(db.agentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "run_1" }, data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
    // tool results were fed back into the conversation
    const lastTurn = seenMessages[seenMessages.length - 1] as Array<{ role: string }>;
    expect(lastTurn.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("takes different investigation paths depending on tool results", async () => {
    // Decision-function fake: reads the actual tool result from the message
    // history and branches. Big impact -> quantify further; zero impact ->
    // pivot to contract terms. Nothing about this sequence is hardcoded.
    async function runBranching(firstArgs: typeof impactArgs) {
      const db = mockDb();
      let calls = 0;
      const norm = (id: string, name: string, args: unknown) => ({
        id,
        name,
        arguments: JSON.stringify(args),
        parsedArgs: args,
      });
      const llm = {
        continueConversation: vi.fn(async (req: { messages: Array<{ role: string; content?: string }> }) => {
          calls += 1;
          if (calls === 1) return { content: PLAN, toolCalls: [], finishReason: "stop", usage: null, model: "fake" };
          const lastTool = [...req.messages].reverse().find((m) => m.role === "tool");
          if (!lastTool) {
            return {
              content: { thinking: "baseline first", done: false },
              toolCalls: [norm("c1", "calculateFinancialImpact", firstArgs)],
              finishReason: "stop", usage: null, model: "fake",
            };
          }
          const impact = (JSON.parse(lastTool.content ?? "{}") as { data?: { totalImpact?: number } }).data?.totalImpact ?? 0;
          if (impact > 0) {
            const priorToolCalls = req.messages.filter((m) => m.role === "tool").length;
            if (priorToolCalls === 1) {
              return {
                content: { thinking: "big impact — quantify at larger scale", done: false },
                toolCalls: [norm("c2", "calculateFinancialImpact", { ...firstArgs, quantity: firstArgs.quantity * 2 })],
                finishReason: "stop", usage: null, model: "fake",
              };
            }
            return {
              content: { thinking: "done", done: true, summary: `confirmed scaled impact ${impact}` },
              toolCalls: [], finishReason: "stop", usage: null, model: "fake",
            };
          }
          const alreadyPivoted = req.messages.some(
            (m) => m.role === "assistant" && JSON.stringify(m).includes("getContract"),
          );
          if (alreadyPivoted) {
            return {
              content: { thinking: "done", done: true, summary: "contract path exhausted" },
              toolCalls: [], finishReason: "stop", usage: null, model: "fake",
            };
          }
          return {
            content: { thinking: "no price impact — pivot to contract terms", done: false },
            toolCalls: [norm("c2", "getContract", { orgId: "org1", contractNumber: "CTR-2024-APEX" })],
            finishReason: "stop", usage: null, model: "fake",
          };
        }),
      } as unknown as InvestigatorClient;
      const res = await runInvestigatorLoop({
        db, llm, toolCtx: toolCtxFor(db), orgId: "org1", incidentId: "inc1", question: "Why did margin fall?",
      });
      const toolNames = ((db.agentStep.create as unknown as { mock: { calls: unknown[][] } }).mock.calls)
        .map((c) => (c[0] as { data: { toolName: string | null } }).data.toolName)
        .filter(Boolean);
      return { res, toolNames };
    }

    // Path A: real overcharge (78540) -> second quantification -> done.
    const pathA = await runBranching(impactArgs);
    expect(pathA.res.status).toBe("COMPLETED");
    expect(pathA.toolNames).toEqual(["calculateFinancialImpact", "calculateFinancialImpact"]);
    expect(pathA.res.answer).toMatchObject({ summary: expect.stringContaining("157080") });

    // Path B: zero impact (baseline == actual) -> pivots to getContract.
    const pathB = await runBranching({ ...impactArgs, actualUnitPrice: 850 });
    expect(pathB.toolNames[0]).toBe("calculateFinancialImpact");
    expect(pathB.toolNames[1]).toBe("getContract");
  });

  it("feeds tool errors back and continues", async () => {
    const db = mockDb();
    const { llm } = fakeLlm([
      { content: { thinking: "try", done: false }, toolCalls: [{ id: "c1", name: "noSuchTool", args: { orgId: "org1" } }] },
      { content: { thinking: "done", done: true, summary: "No valid tool available." } },
    ]);
    const res = await runInvestigatorLoop({
      db, llm, toolCtx: toolCtxFor(db), orgId: "org1", incidentId: "inc1", question: "Why?",
    });
    expect(res.status).toBe("COMPLETED");
    expect(res.toolCallsExecuted).toBe(1);
    expect(db.incidentEvidence.create).toHaveBeenCalledTimes(1);
  });

  it("handles malformed tool arguments without crashing", async () => {
    const db = mockDb();
    const { llm } = fakeLlm([
      { content: { thinking: "try", done: false }, toolCalls: [{ id: "c1", name: "calculateFinancialImpact", args: "{bad json" }] },
      { content: { thinking: "done", done: true, summary: "Args were malformed; stopped." } },
    ]);
    const res = await runInvestigatorLoop({
      db, llm, toolCtx: toolCtxFor(db), orgId: "org1", incidentId: "inc1", question: "Why?",
    });
    expect(res.status).toBe("COMPLETED");
    expect(res.toolCallsExecuted).toBe(1);
  });

  it("stops at max iterations", async () => {
    const db = mockDb();
    const { llm } = fakeLlm([
      { content: { thinking: "more", done: false }, toolCalls: [{ id: "c1", name: "calculateFinancialImpact", args: impactArgs }] },
    ]);
    const res = await runInvestigatorLoop({
      db, llm, toolCtx: toolCtxFor(db), orgId: "org1", incidentId: "inc1",
      question: "Why?", maxIterations: 2,
    });
    expect(res.status).toBe("MAX_ITERATIONS");
    expect(res.iterations).toBe(2);
  });

  it("retries transient LLM failures then proceeds", async () => {
    const db = mockDb();
    let calls = 0;
    const llm = {
      continueConversation: vi.fn(async (req: { responseSchema: { name: string } }) => {
        calls += 1;
        if (calls === 1) throw new InvestigatorError("SERVER", "boom", true);
        if (req.responseSchema.name === "investigation_plan") {
          return { content: PLAN, toolCalls: [], finishReason: "stop", usage: null, model: "fake" };
        }
        return { content: { thinking: "recovered", done: true, summary: "Recovered." }, toolCalls: [], finishReason: "stop", usage: null, model: "fake" };
      }),
    } as unknown as InvestigatorClient;
    const res = await runInvestigatorLoop({
      db, llm, toolCtx: toolCtxFor(db), orgId: "org1", incidentId: "inc1", question: "Why?",
    });
    expect(res.status).toBe("COMPLETED");
    expect(calls).toBe(3);
  });

  it("supports cancellation via AbortSignal", async () => {
    const db = mockDb();
    const { llm } = fakeLlm([{ content: { summary: "x" } }]);
    const controller = new AbortController();
    controller.abort();
    const res = await runInvestigatorLoop({
      db, llm, toolCtx: toolCtxFor(db), orgId: "org1", incidentId: "inc1",
      question: "Why?", signal: controller.signal,
    });
    expect(res.status).toBe("CANCELLED");
  });

  it("abandons an unsupported hypothesis and investigates another explanation", async () => {
    const db = mockDb();
    const { llm } = fakeLlm([
      {
        content: {
          thinking: "COGS first",
          done: false,
          hypotheses: [
            { statement: "COGS increase caused margin decline.", status: "INVESTIGATING", confidence: 0.6 },
          ],
        },
        toolCalls: [{ id: "c1", name: "calculateFinancialImpact", args: { ...impactArgs, actualUnitPrice: 850 } }],
      },
      {
        // Zero price impact contradicts the COGS story: reject it, open revenue-leakage.
        content: {
          thinking: "COGS ruled out, pivoting",
          done: false,
          hypotheses: [
            {
              statement: "COGS increase caused margin decline.",
              status: "REJECTED",
              confidence: 0.1,
              contradicting: ["price impact is zero at actual == baseline"],
            },
            { statement: "Revenue leakage caused margin decline.", status: "INVESTIGATING", confidence: 0.55 },
          ],
        },
        toolCalls: [{ id: "c2", name: "calculateFinancialImpact", args: impactArgs }],
      },
      {
        content: {
          thinking: "done",
          done: true,
          summary: "Revenue-side overcharge of 78540 explains the decline.",
          hypotheses: [
            { statement: "Revenue leakage caused margin decline.", status: "SUPPORTED", confidence: 0.85 },
          ],
        },
      },
    ]);
    const res = await runInvestigatorLoop({
      db,
      llm,
      toolCtx: toolCtxFor(db),
      orgId: "org1",
      incidentId: "inc1",
      question: "Why did gross margin fall in August?",
    });
    expect(res.status).toBe("COMPLETED");
    const byStatement = Object.fromEntries(res.hypotheses.map((h) => [h.statement, h]));
    expect(byStatement["COGS increase caused margin decline."].status).toBe("REJECTED");
    expect(byStatement["COGS increase caused margin decline."].contradictoryEvidence).toHaveLength(1);
    expect(byStatement["Revenue leakage caused margin decline."].status).toBe("SUPPORTED");
    // agent created structured findings during the investigation, mirroring
    // hypotheses with statement/type/status/confidence + agent step links
    expect(res.findings).toHaveLength(2);
    const findingsByStatement = Object.fromEntries(res.findings.map((f) => [f.statement, f]));
    expect(findingsByStatement["COGS increase caused margin decline."]).toMatchObject({
      type: "HYPOTHESIS",
      status: "REJECTED",
      incidentId: "inc1",
    });
    expect(findingsByStatement["Revenue leakage caused margin decline."].status).toBe("SUPPORTED");
    for (const f of res.findings) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.agentStepId).toMatch(/^step_\d+$/);
    }
    // hypotheses persisted as findings; tool evidence linked to a finding
    expect(db.incidentFinding.create).toHaveBeenCalled();
    const evidenceCalls = (db.incidentEvidence.create as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(evidenceCalls.length).toBe(2);
    const linked = evidenceCalls.filter(
      (c) => (c[0] as { data: { findingId: string | null } }).data.findingId !== null,
    );
    expect(linked.length).toBeGreaterThan(0);
  });
});
