// Route-level tests for the incident agent APIs:
//   POST /api/incidents/[id]/investigate  (Zod validation + LoopStatus → 200)
//   GET  /api/incidents/[id]/runs
//   GET  /api/incidents/[id]/runs/[runId]/steps
//
// The prisma singleton and the loop module are mocked; everything else
// (services, validation, investigator-client construction) runs for real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { db, runInvestigatorLoop } = vi.hoisted(() => ({
  db: {
    organization: { findUnique: vi.fn(), findFirst: vi.fn() },
    financialIncident: { findFirst: vi.fn() },
    agentRun: { findMany: vi.fn(), findFirst: vi.fn() },
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
}

function post(url: string, body: unknown) {
  return investigatePost(
    new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

  it("defaults optional fields and maps every LoopStatus to HTTP 200", async () => {
    for (const status of ["MAX_ITERATIONS", "FAILED", "CANCELLED"]) {
      runInvestigatorLoop.mockResolvedValue({ status, runId: "run_xyz" });
      const res = await post(baseUrl, { question: "Why did gross margin fall in August?" });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ status, runId: "run_xyz" });
      const arg = runInvestigatorLoop.mock.calls[0][0] as Record<string, unknown>;
      // optional fields omitted → defaults (loop applies maxIterations = 8)
      expect(arg.maxIterations).toBeUndefined();
      expect(arg.actorId).toBeUndefined();
      expect(arg.toolCtx).toEqual({ db, orgId: ORG.id });
    }
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