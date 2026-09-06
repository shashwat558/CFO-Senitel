// Route-level tests for the incident agent APIs:
//   POST /api/incidents/[id]/investigate  (Zod validation + concurrency guard +
//                                          Idempotency-Key replay + distinct
//                                          outcome codes)
//   GET  /api/incidents/[id]/runs
//   GET  /api/incidents/[id]/runs/[runId]/steps
//
// The prisma singleton and the loop module are mocked; everything else
// (services, validation, investigator-client construction) runs for real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { LoopStatus } from "../lib/agent/investigator-loop";

const { db, runInvestigatorLoop } = vi.hoisted(() => ({
  db: {
    organization: { findUnique: vi.fn(), findFirst: vi.fn() },
    financialIncident: { findFirst: vi.fn() },
    agentRun: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    agentStep: { findMany: vi.fn() },
  },
  runInvestigatorLoop: vi.fn(),
}));

vi.mock("@/lib/agent/investigator-loop", () => ({ runInvestigatorLoop }));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { POST as investigatePost } from "../app/api/incidents/[id]/investigate/route";
import { GET as runsGet } from "../app/api/incidents/[id]/runs/route";
import { GET as stepsGet } from "../app/api/incidents/[id]/runs/[runId]/steps/route";

const ORG = { id: "org_acme_industries", name: "Acme Industries", slug: "acme-industries" };
const INCIDENT = { id: "incident_gm_aug2024", orgId: ORG.id, title: "Gross margin decline" };
const baseUrl = "http://localhost/api/incidents/incident_gm_aug2024";

function mockOrgAndIncident() {
  db.organization.findUnique.mockResolvedValue(ORG);
  db.financialIncident.findFirst.mockResolvedValue(INCIDENT);
  // Defaults: no prior idempotency-key run, no RUNNING investigation in flight.
  db.agentRun.findFirst.mockResolvedValue(null);
  db.agentRun.count.mockResolvedValue(0);
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return investigatePost(
    new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: { id: "incident_gm_aug2024" } }
  );
}

describe("POST /api/incidents/[id]/investigate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgAndIncident();
  });

  it("rejects a missing/short question with 400 before touching the loop", async () => {
    const res = await post(baseUrl, { question: "x" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid investigation request/);
    expect(runInvestigatorLoop).not.toHaveBeenCalled();
  });

  it("tolerates unknown body fields (Zod strips them, like createIncident)", async () => {
    runInvestigatorLoop.mockResolvedValue({ status: "COMPLETED", runId: "run_strip" });
    const res = await post(baseUrl, { question: "Why did margin fall?", unexpected: 1 });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "COMPLETED", runId: "run_strip" });
    expect(runInvestigatorLoop).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the incident is not in the org", async () => {
    db.financialIncident.findFirst.mockResolvedValue(null);
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" });
    expect(res.status).toBe(404);
    expect(runInvestigatorLoop).not.toHaveBeenCalled();
  });

  it("runs the loop and maps COMPLETED to HTTP 200 with { status, runId }", async () => {
    runInvestigatorLoop.mockResolvedValue({ status: "COMPLETED", runId: "run_abc", iterations: 3 });
    const res = await post(baseUrl, {
      question: "Why did gross margin fall in August?",
      maxIterations: 6,
      actorId: "user_maya_chen",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "COMPLETED", runId: "run_abc" });

    expect(runInvestigatorLoop).toHaveBeenCalledTimes(1);
    const arg = runInvestigatorLoop.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      db,
      orgId: ORG.id,
      incidentId: INCIDENT.id,
      question: "Why did gross margin fall in August?",
      maxIterations: 6,
      actorId: "user_maya_chen",
      toolCtx: { db, orgId: ORG.id, actorId: "user_maya_chen" },
      llm: expect.any(Object),
    });
    // the loop gets a real AbortSignal so the whole run can be cancelled
    expect(arg.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps distinct loop outcomes to distinct HTTP codes", async () => {
    const cases: Array<[LoopStatus, number]> = [
      ["COMPLETED", 200],
      ["MAX_ITERATIONS", 200],
      ["FAILED", 500],
      ["CANCELLED", 499],
    ];
    for (const [status, http] of cases) {
      runInvestigatorLoop.mockResolvedValue({ status, runId: "run_xyz" });
      const res = await post(baseUrl, { question: "Why did gross margin fall in August?" });
      expect(res.status).toBe(http);
      await expect(res.json()).resolves.toEqual({ status, runId: "run_xyz" });
    }
    // optional body fields omitted → not passed (loop applies its defaults:
    // maxIterations = 8, maxLlmRetries = 2)
    const arg = runInvestigatorLoop.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.maxIterations).toBeUndefined();
    expect(arg.maxLlmRetries).toBeUndefined();
    expect(arg.actorId).toBeUndefined();
    expect(arg.toolCtx).toEqual({ db, orgId: ORG.id });
  });

  it("passes cost caps (maxIterations, maxLlmRetries) through to the loop", async () => {
    runInvestigatorLoop.mockResolvedValue({ status: "COMPLETED", runId: "run_caps" });
    const res = await post(baseUrl, {
      question: "Why did gross margin fall in August?",
      maxIterations: 3,
      maxLlmRetries: 0,
    });
    expect(res.status).toBe(200);
    const arg = runInvestigatorLoop.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.maxIterations).toBe(3);
    expect(arg.maxLlmRetries).toBe(0);
  });

  it("rejects out-of-range maxLlmRetries with 400 before touching the loop", async () => {
    for (const maxLlmRetries of [-1, 6, 1.5]) {
      const res = await post(baseUrl, { question: "Why did margin fall?", maxLlmRetries });
      expect(res.status).toBe(400);
      expect(runInvestigatorLoop).not.toHaveBeenCalled();
    }
  });

  it("returns 409 while another investigation for the incident is RUNNING", async () => {
    db.agentRun.count.mockResolvedValue(1);
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("already running") });
    expect(runInvestigatorLoop).not.toHaveBeenCalled();
    expect(db.agentRun.count).toHaveBeenCalledWith({
      where: { orgId: ORG.id, incidentId: INCIDENT.id, status: "RUNNING" },
    });
  });

  it("replays a COMPLETED run when Idempotency-Key matches (loop not re-run)", async () => {
    db.agentRun.findFirst.mockResolvedValue({
      id: "run_old",
      orgId: ORG.id,
      incidentId: INCIDENT.id,
      status: "COMPLETED",
      output: {},
    });
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" }, { "Idempotency-Key": "key-123" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "COMPLETED", runId: "run_old" });
    expect(runInvestigatorLoop).not.toHaveBeenCalled();
    expect(db.agentRun.count).not.toHaveBeenCalled();
    expect(db.agentRun.findFirst).toHaveBeenCalledWith({
      where: { orgId: ORG.id, idempotencyKey: "key-123" },
    });
  });

  it("replays a MAX_ITERATIONS run (COMPLETED row with stopped=MAX_ITERATIONS) as MAX_ITERATIONS", async () => {
    db.agentRun.findFirst.mockResolvedValue({
      id: "run_old",
      orgId: ORG.id,
      incidentId: INCIDENT.id,
      status: "COMPLETED",
      output: { stopped: "MAX_ITERATIONS" },
    });
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" }, { "Idempotency-Key": "key-123" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "MAX_ITERATIONS", runId: "run_old" });
    expect(runInvestigatorLoop).not.toHaveBeenCalled();
  });

  it("replays a FAILED run as 500 (still idempotent — no new loop)", async () => {
    db.agentRun.findFirst.mockResolvedValue({
      id: "run_failed",
      orgId: ORG.id,
      incidentId: INCIDENT.id,
      status: "FAILED",
      output: { error: "boom" },
    });
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" }, { "Idempotency-Key": "key-123" });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ status: "FAILED", runId: "run_failed" });
    expect(runInvestigatorLoop).not.toHaveBeenCalled();
  });

  it("returns 409 when the Idempotency-Key run is still RUNNING", async () => {
    db.agentRun.findFirst.mockResolvedValue({
      id: "run_inflight",
      orgId: ORG.id,
      incidentId: INCIDENT.id,
      status: "RUNNING",
      output: null,
    });
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" }, { "Idempotency-Key": "key-123" });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("already running") });
    expect(runInvestigatorLoop).not.toHaveBeenCalled();
  });

  it("returns 409 when a key is reused for a different incident", async () => {
    db.agentRun.findFirst.mockResolvedValue({
      id: "run_other",
      orgId: ORG.id,
      incidentId: "incident_other",
      status: "COMPLETED",
      output: {},
    });
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" }, { "Idempotency-Key": "key-123" });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("different incident") });
    expect(runInvestigatorLoop).not.toHaveBeenCalled();
  });

  it("maps a same-key DB unique violation (P2002) to 409 instead of 500", async () => {
    runInvestigatorLoop.mockRejectedValue({ code: "P2002", message: "Unique constraint failed on the fields: (`orgId`,`idempotencyKey`)" });
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" }, { "Idempotency-Key": "key-123" });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("idempotency key") });
  });

  it("re-throws non-unique loop failures with their service status", async () => {
    runInvestigatorLoop.mockRejectedValue(new TypeError("llm exploded"));
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" });
    expect(res.status).toBe(500);
  });

  it("passes the Idempotency-Key through to a fresh loop run", async () => {
    runInvestigatorLoop.mockResolvedValue({ status: "COMPLETED", runId: "run_new" });
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" }, { "idempotency-key": "key-456" });
    expect(res.status).toBe(200);
    const arg = runInvestigatorLoop.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.idempotencyKey).toBe("key-456");
  });

  it("surfaces loop-internal setup errors with service status (e.g. missing org → 503)", async () => {
    db.organization.findUnique.mockResolvedValue(null);
    db.organization.findFirst.mockResolvedValue(null); // no fallback org either
    const res = await post(baseUrl, { question: "Why did gross margin fall in August?" });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("no organization") });
  });
});

describe("GET /api/incidents/[id]/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgAndIncident();
  });

  it("lists org-scoped runs for the incident, newest first", async () => {
    db.agentRun.findMany.mockResolvedValue([{ id: "run_1" }, { id: "run_0" }]);
    const res = await runsGet(new NextRequest(`${baseUrl}/runs`), { params: { id: INCIDENT.id } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [{ id: "run_1" }, { id: "run_0" }] });
    expect(db.agentRun.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG.id, incidentId: INCIDENT.id },
      orderBy: { startedAt: "desc" },
      include: { _count: { select: { steps: true } } },
    });
  });

  it("returns 404 when the incident is not in the org", async () => {
    db.financialIncident.findFirst.mockResolvedValue(null);
    const res = await runsGet(new NextRequest(`${baseUrl}/runs`), { params: { id: INCIDENT.id } });
    expect(res.status).toBe(404);
    expect(db.agentRun.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/incidents/[id]/runs/[runId]/steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgAndIncident();
  });

  it("lists steps for a run belonging to the incident, in seq order", async () => {
    db.agentRun.findFirst.mockResolvedValue({ id: "run_1", orgId: ORG.id, incidentId: INCIDENT.id });
    db.agentStep.findMany.mockResolvedValue([{ seq: 2 }, { seq: 1 }]);
    const res = await stepsGet(new NextRequest(`${baseUrl}/runs/run_1/steps`), {
      params: { id: INCIDENT.id, runId: "run_1" },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [{ seq: 2 }, { seq: 1 }] });
    expect(db.agentRun.findFirst).toHaveBeenCalledWith({
      where: { id: "run_1", orgId: ORG.id, incidentId: INCIDENT.id },
    });
    expect(db.agentStep.findMany).toHaveBeenCalledWith({
      where: { runId: "run_1" },
      orderBy: { seq: "asc" },
    });
  });

  it("returns 404 when the run does not belong to the incident", async () => {
    db.agentRun.findFirst.mockResolvedValue(null);
    const res = await stepsGet(new NextRequest(`${baseUrl}/runs/run_missing/steps`), {
      params: { id: INCIDENT.id, runId: "run_missing" },
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("run") });
    expect(db.agentStep.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the incident is not in the org", async () => {
    db.financialIncident.findFirst.mockResolvedValue(null);
    const res = await stepsGet(new NextRequest(`${baseUrl}/runs/run_1/steps`), {
      params: { id: INCIDENT.id, runId: "run_1" },
    });
    expect(res.status).toBe(404);
    expect(db.agentRun.findFirst).not.toHaveBeenCalled();
  });
});