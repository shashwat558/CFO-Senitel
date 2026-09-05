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
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaClient;
}

const toolCtxFor = (db: PrismaClient) => ({ db, orgId: "org1" });

function fakeLlm(script: Array<{ content: unknown; toolCalls?: Array<{ id: string; name: string; args: unknown }> }>) {
  const seenMessages: unknown[][] = [];
  let i = 0;
  const llm = {
    continueConversation: vi.fn(async (req: { messages: unknown[] }) => {
      seenMessages.push(req.messages);
      const turn = script[Math.min(i, script.length - 1)];
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
  return { llm, seenMessages };
}

const impactArgs = { orgId: "org1", baselineUnitPrice: 850, actualUnitPrice: 1088, quantity: 330 };

describe("investigator tool loop", () => {
  it("calls multiple tools sequentially then answers", async () => {
    const db = mockDb();
    const { llm, seenMessages } = fakeLlm([
      { content: { summary: "checking" }, toolCalls: [{ id: "c1", name: "calculateFinancialImpact", args: impactArgs }] },
      { content: { summary: "checking more" }, toolCalls: [{ id: "c2", name: "calculateFinancialImpact", args: impactArgs }] },
      { content: { summary: "Overcharge of 78540 explains the decline.", findings: [], needsMoreEvidence: false } },
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
    expect(res.answer).toMatchObject({ summary: expect.stringContaining("78540") });
    // every step persisted: 3 llm turns + 2 tool executions
    expect(db.agentStep.create).toHaveBeenCalledTimes(5);
    expect(db.incidentEvidence.create).toHaveBeenCalledTimes(2);
    expect(db.agentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "run_1" }, data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
    // tool results were fed back into the conversation
    const lastTurn = seenMessages[2] as Array<{ role: string }>;
    expect(lastTurn.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("feeds tool errors back and continues", async () => {
    const db = mockDb();
    const { llm } = fakeLlm([
      { content: null, toolCalls: [{ id: "c1", name: "noSuchTool", args: { orgId: "org1" } }] },
      { content: { summary: "No valid tool available." } },
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
      { content: null, toolCalls: [{ id: "c1", name: "calculateFinancialImpact", args: "{bad json" }] },
      { content: { summary: "Args were malformed; stopped." } },
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
      { content: null, toolCalls: [{ id: "c1", name: "calculateFinancialImpact", args: impactArgs }] },
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
      continueConversation: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new InvestigatorError("SERVER", "boom", true);
        return { content: { summary: "Recovered." }, toolCalls: [], finishReason: "stop", usage: null, model: "fake" };
      }),
    } as unknown as InvestigatorClient;
    const res = await runInvestigatorLoop({
      db, llm, toolCtx: toolCtxFor(db), orgId: "org1", incidentId: "inc1", question: "Why?",
    });
    expect(res.status).toBe("COMPLETED");
    expect(calls).toBe(2);
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
});
