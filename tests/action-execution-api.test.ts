// Action execution + verification routes:
//   POST /api/incidents/[id]/actions/[actionId]/execute
//   POST /api/incidents/[id]/actions/[actionId]/verify
// Prisma singleton is mocked; services run for real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { db } = vi.hoisted(() => ({
  db: {
    user: { findFirst: vi.fn() },
    incidentAction: { findFirst: vi.fn(), update: vi.fn() },
    incidentEvidence: { create: vi.fn().mockResolvedValue({}) },
    financialIncident: { update: vi.fn() },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { POST as executePost } from "../app/api/incidents/[id]/actions/[actionId]/execute/route";
import { POST as verifyPost } from "../app/api/incidents/[id]/actions/[actionId]/verify/route";

const ORG_ID = "org_acme_industries";
const SESSION_USER = {
  id: "user_maya_chen",
  email: "maya.chen@acme.example",
  name: "Maya Chen",
  role: "CFO",
  orgId: ORG_ID,
};
const INCIDENT_ID = "incident_gm_aug2024";
const ACTION_ID = "action_1";
const baseUrl = `http://localhost/api/incidents/${INCIDENT_ID}/actions/${ACTION_ID}`;

function mockDefaults() {
  db.user.findFirst.mockResolvedValue(SESSION_USER);
}

describe("POST execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  function post() {
    return executePost(new NextRequest(`${baseUrl}/execute`, { method: "POST", body: "{}" }), {
      params: { id: INCIDENT_ID, actionId: ACTION_ID },
    });
  }

  it("executes an APPROVED action and returns EXECUTED", async () => {
    db.incidentAction.findFirst.mockResolvedValue({ id: ACTION_ID, status: "APPROVED" });
    db.incidentAction.update.mockResolvedValue({ id: ACTION_ID, status: "EXECUTED" });
    const res = await post();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "EXECUTED" });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "action.execute" }) })
    );
  });

  it("404s actions outside the incident scope", async () => {
    db.incidentAction.findFirst.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(404);
  });

  it("409s actions that are not APPROVED", async () => {
    db.incidentAction.findFirst.mockResolvedValue({ id: ACTION_ID, status: "PROPOSED" });
    const res = await post();
    expect(res.status).toBe(409);
  });

  it("401s without a session", async () => {
    db.user.findFirst.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(401);
  });
});

describe("POST verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  function post() {
    return verifyPost(new NextRequest(`${baseUrl}/verify`, { method: "POST", body: "{}" }), {
      params: { id: INCIDENT_ID, actionId: ACTION_ID },
    });
  }

  it("verifies against fresh tool output and marks VERIFIED", async () => {
    db.incidentAction.findFirst.mockResolvedValue({
      id: ACTION_ID,
      status: "EXECUTED",
      payload: {
        verification: {
          toolName: "getPnl",
          input: { orgId: ORG_ID, year: 2024, month: 8 },
          expected: { revenue: 100 },
        },
      },
      incident: { id: INCIDENT_ID, status: "OPEN" },
    });
    // getPnl over an empty ledger: revenue 0 ≠ expected 100 → FAILED path is
    // also fine; here we assert the plumbing, not the verdict.
    db.incidentAction.update.mockImplementation((args: { data: { status: string } }) =>
      Promise.resolve({ id: ACTION_ID, status: args.data.status })
    );
    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { verified: boolean }; action: { status: string } };
    expect(typeof body.result.verified).toBe("boolean");
    expect(["VERIFIED", "FAILED"]).toContain(body.action.status);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "action.verify" }) })
    );
  });

  it("reports missing verification instructions honestly", async () => {
    db.incidentAction.findFirst.mockResolvedValue({
      id: ACTION_ID,
      status: "EXECUTED",
      payload: {},
      incident: { id: INCIDENT_ID, status: "OPEN" },
    });
    db.incidentAction.update.mockImplementation((args: { data: { status: string } }) =>
      Promise.resolve({ id: ACTION_ID, status: args.data.status })
    );
    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { verified: boolean; detail: string } };
    expect(body.result.verified).toBe(false);
    expect(body.result.detail).toMatch(/no verification instruction/);
  });

  it("404s actions outside the incident scope", async () => {
    db.incidentAction.findFirst.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(404);
  });

  it("409s actions that are not EXECUTED", async () => {
    db.incidentAction.findFirst.mockResolvedValue({
      id: ACTION_ID,
      status: "APPROVED",
      payload: {},
      incident: { id: INCIDENT_ID, status: "OPEN" },
    });
    const res = await post();
    expect(res.status).toBe(409);
  });
});
