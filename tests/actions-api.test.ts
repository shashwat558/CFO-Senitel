// Route + service tests for the Phase 3 action/approval flow:
//   POST /api/incidents/[id]/actions          (propose: PROPOSED + PENDING approval)
//   POST /api/approvals/[id]/approve|reject   (role-check stub + state transitions)
//   executeAction worker stub                 (APPROVED → EXECUTED/FAILED + simulationResult)
// plus the wired schemas (lib/actions/types, lib/approvals/types).
//
// The prisma singleton is mocked; services + validation run for real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { executeAction, type ActionActor } from "../lib/services/actions";
import { decideApproval } from "../lib/services/approvals";
import { proposedActionSchema } from "../lib/actions/types";
import { approvalDecisionSchema, approveRejectSchema } from "../lib/approvals/types";

const { db } = vi.hoisted(() => ({
  db: {
    organization: { findUnique: vi.fn(), findFirst: vi.fn() },
    financialIncident: { findFirst: vi.fn() },
    incidentFinding: { findFirst: vi.fn() },
    incidentAction: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    approval: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { POST as proposePost } from "../app/api/incidents/[id]/actions/route";
import { POST as approvePost } from "../app/api/approvals/[id]/approve/route";
import { POST as rejectPost } from "../app/api/approvals/[id]/reject/route";

const ORG = { id: "org_acme_industries", name: "Acme Industries", slug: "acme-industries" };
const INCIDENT = { id: "incident_gm_aug2024", orgId: ORG.id, title: "Gross margin decline" };
const FINDING = { id: "finding_apex", incidentId: INCIDENT.id, title: "Apex overcharge" };
const ACTION = {
  id: "action_1",
  incidentId: INCIDENT.id,
  title: "Claw back Apex overcharge",
  description: "",
  type: "RECOMMENDATION",
  status: "PROPOSED",
  payload: { findingId: FINDING.id },
  simulationResult: null,
};
const APPROVAL = {
  id: "approval_1",
  orgId: ORG.id,
  incidentId: INCIDENT.id,
  actionId: ACTION.id,
  requestedById: "user_maya_chen",
  decidedById: null,
  status: "PENDING",
  reason: "",
  decidedAt: null,
};
const USER_CFO = { id: "user_maya_chen", orgId: ORG.id, role: "CFO", name: "Maya Chen" };
const USER_VIEWER = { id: "user_priya_nair", orgId: ORG.id, role: "VIEWER", name: "Priya Nair" };

function mockDefaults() {
  db.organization.findUnique.mockResolvedValue(ORG);
  db.financialIncident.findFirst.mockResolvedValue(INCIDENT);
  db.incidentFinding.findFirst.mockResolvedValue(FINDING);
  db.user.findFirst.mockImplementation(({ where }: { where: { orgId: string } }) =>
    Promise.resolve(USER_CFO)
  );
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  db.auditLog.create.mockResolvedValue({});
  db.incidentAction.create.mockResolvedValue(ACTION);
  db.approval.create.mockResolvedValue(APPROVAL);
  db.approval.findFirst.mockResolvedValue(APPROVAL);
  db.incidentAction.findFirst.mockResolvedValue({ ...ACTION, status: "APPROVED" });
  db.incidentAction.findUnique.mockResolvedValue(ACTION);
  db.incidentAction.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ ...ACTION, ...data })
  );
  db.approval.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ ...APPROVAL, ...data })
  );
}

function post<P extends Record<string, string>>(
  handler: (req: Request, ctx: { params: P }) => Promise<Response>,
  url: string,
  body: unknown,
  params: P
) {
  return handler(
    new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params }
  );
}

const propose = (body: unknown, id = INCIDENT.id) =>
  post(proposePost, `http://localhost/api/incidents/${id}/actions`, body, { id });
const approve = (body: unknown, id = APPROVAL.id) =>
  post(approvePost, `http://localhost/api/approvals/${id}/approve`, body, { id });
const reject = (body: unknown, id = APPROVAL.id) =>
  post(rejectPost, `http://localhost/api/approvals/${id}/reject`, body, { id });

describe("POST /api/incidents/[id]/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("creates a PROPOSED action + PENDING approval and audits with the session actor", async () => {
    const res = await propose({
      findingId: FINDING.id,
      title: "Claw back Apex overcharge",
      payload: { amount: 78540 },
    });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      action: { id: ACTION.id, status: "PROPOSED" },
      approval: { id: APPROVAL.id, status: "PENDING" },
    });

    expect(db.incidentAction.create).toHaveBeenCalledWith({
      data: {
        incidentId: INCIDENT.id,
        type: "RECOMMENDATION",
        title: "Claw back Apex overcharge",
        description: "",
        status: "PROPOSED",
        payload: { amount: 78540, findingId: FINDING.id },
      },
    });
    expect(db.approval.create).toHaveBeenCalledWith({
      data: {
        orgId: ORG.id,
        incidentId: INCIDENT.id,
        actionId: ACTION.id,
        requestedById: USER_CFO.id,
        status: "PENDING",
      },
    });
    // the session user requests the approval and is the audit actor
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: USER_CFO.id, orgId: ORG.id },
      select: { id: true },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG.id,
        actorId: USER_CFO.id,
        action: "action.propose",
        entityType: "IncidentAction",
        entityId: ACTION.id,
      }),
    });
  });

  it("rejects a missing findingId or short title with 400 before any write", async () => {
    for (const body of [
      { title: "Claw back Apex overcharge" },
      { findingId: FINDING.id, title: "x" },
    ]) {
      const res = await propose(body);
      expect(res.status).toBe(400);
      expect(db.incidentAction.create).not.toHaveBeenCalled();
    }
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the incident is not in the org", async () => {
    db.financialIncident.findFirst.mockResolvedValue(null);
    const res = await propose({ findingId: FINDING.id, title: "Claw back Apex overcharge" });
    expect(res.status).toBe(404);
    expect(db.incidentAction.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the finding does not belong to the incident", async () => {
    db.incidentFinding.findFirst.mockResolvedValue(null);
    const res = await propose({ findingId: FINDING.id, title: "Claw back Apex overcharge" });
    expect(res.status).toBe(404);
    expect(db.incidentAction.create).not.toHaveBeenCalled();
    // resolved org-scoped within the incident
    expect(db.incidentFinding.findFirst).toHaveBeenCalledWith({
      where: { id: FINDING.id, incidentId: INCIDENT.id },
      select: { id: true },
    });
  });
});

describe("POST /api/approvals/[id]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("transitions approval PENDING→APPROVED and action PROPOSED→APPROVED, records the session CFO as decider + actor", async () => {
    const res = await approve({ reason: "Matches vendor contract analysis" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      approval: { status: "APPROVED" },
      action: { status: "APPROVED" },
    });

    expect(db.approval.update).toHaveBeenCalledWith({
      where: { id: APPROVAL.id },
      data: expect.objectContaining({
        status: "APPROVED",
        decidedById: USER_CFO.id,
        decidedAt: expect.any(Date),
        reason: "Matches vendor contract analysis",
      }),
    });
    expect(db.incidentAction.update).toHaveBeenCalledWith({
      where: { id: ACTION.id },
      data: { status: "APPROVED" },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG.id,
        actorId: USER_CFO.id,
        action: "approval.approve",
        entityType: "Approval",
        entityId: APPROVAL.id,
      }),
    });
  });

  it("enforces the CFO/CONTROLLER role gate: a VIEWER session cannot approve (403)", async () => {
    // Session stub resolves to the VIEWER (no auth yet → deterministic stub).
    db.user.findFirst.mockResolvedValue(USER_VIEWER);
    const res = await approve({ reason: "nope" });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("role") });
    expect(db.approval.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("service-level: rejects a non-CFO/CONTROLLER role before any update", async () => {
    db.user.findFirst.mockResolvedValue(USER_VIEWER);
    const outcome = await decideApproval(db as unknown as PrismaClient, ORG.id, {
      approvalId: APPROVAL.id,
      decision: "APPROVED",
      decidedById: USER_VIEWER.id,
    }).then(
      (ok: unknown) => ok,
      (e: unknown) => ({ error: e })
    );
    expect(outcome).toMatchObject({ error: { status: 403 } });
    expect(db.approval.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("service-level: 404 when a supplied decider is not an org user", async () => {
    // Session resolution (findFirst without orgId) still succeeds; the decider
    // lookup (findFirst with orgId) misses.
    db.user.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.orgId ? null : USER_CFO)
    );
    const outcome = await decideApproval(db as unknown as PrismaClient, ORG.id, {
      approvalId: APPROVAL.id,
      decision: "APPROVED",
      decidedById: "user_ghost",
    }).then(
      (ok: unknown) => ok,
      (e: unknown) => ({ error: e })
    );
    expect(outcome).toMatchObject({ error: { status: 404 } });
    expect(db.approval.update).not.toHaveBeenCalled();
  });

  it("returns 409 when the approval is already decided", async () => {
    db.approval.findFirst.mockResolvedValue({ ...APPROVAL, status: "APPROVED" });
    const res = await approve({});
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("already") });
    expect(db.approval.update).not.toHaveBeenCalled();
  });

  it("returns 409 when the linked action is already past PROPOSED", async () => {
    db.incidentAction.findUnique.mockResolvedValue({ ...ACTION, status: "EXECUTED" });
    const res = await approve({});
    expect(res.status).toBe(409);
    // the action transition never runs — the decision transaction aborts
    expect(db.incidentAction.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the approval is not in the org", async () => {
    db.approval.findFirst.mockResolvedValue(null);
    const res = await approve({});
    expect(res.status).toBe(404);
  });

  it("strips body-level approvalId/decision — the URL + endpoint decide", async () => {
    const res = await approve({ approvalId: "approval_evil", decision: "REJECTED" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ approval: { status: "APPROVED" } });
    expect(db.approval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: APPROVAL.id },
        data: expect.objectContaining({ status: "APPROVED" }),
      })
    );
  });
});

describe("POST /api/approvals/[id]/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("transitions approval PENDING→REJECTED and action PROPOSED→REJECTED, audits rejection", async () => {
    const res = await reject({ reason: "Surcharge was pre-approved by the buyer" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      approval: { status: "REJECTED" },
      action: { status: "REJECTED" },
    });
    expect(db.approval.update).toHaveBeenCalledWith({
      where: { id: APPROVAL.id },
      data: expect.objectContaining({
        status: "REJECTED",
        decidedById: USER_CFO.id,
        reason: "Surcharge was pre-approved by the buyer",
      }),
    });
    expect(db.incidentAction.update).toHaveBeenCalledWith({
      where: { id: ACTION.id },
      data: { status: "REJECTED" },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorId: USER_CFO.id, action: "approval.reject" }),
    });
  });

  it("enforces the role gate: a VIEWER session cannot reject (403)", async () => {
    db.user.findFirst.mockResolvedValue(USER_VIEWER);
    const res = await reject({ reason: "nope" });
    expect(res.status).toBe(403);
    expect(db.approval.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns 409 when already decided", async () => {
    db.approval.findFirst.mockResolvedValue({ ...APPROVAL, status: "REJECTED" });
    const res = await reject({});
    expect(res.status).toBe(409);
  });
});

describe("executeAction — execution worker stub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  const execute = (actionId: string, actor: ActionActor = USER_CFO) =>
    executeAction(db as unknown as PrismaClient, ORG.id, actionId, { actor });

  it("transitions APPROVED → EXECUTED with a simulationResult Json + audit by the actor", async () => {
    const updated = await execute(ACTION.id);
    expect(updated.status).toBe("EXECUTED");
    expect(updated.simulationResult).toMatchObject({ ok: true, engine: "stub", status: "EXECUTED" });
    expect(db.incidentAction.update).toHaveBeenCalledWith({
      where: { id: ACTION.id },
      data: {
        status: "EXECUTED",
        simulationResult: expect.objectContaining({ ok: true }),
      },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG.id,
        actorId: USER_CFO.id,
        action: "action.execute",
      }),
    });
  });

  it("enforces the CFO/CONTROLLER role gate: a VIEWER actor cannot execute (403)", async () => {
    await expect(execute(ACTION.id, { id: USER_VIEWER.id, role: USER_VIEWER.role })).rejects.toMatchObject({
      status: 403,
    });
    expect(db.incidentAction.findFirst).not.toHaveBeenCalled();
    expect(db.incidentAction.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses to execute anything but an APPROVED action (409)", async () => {
    db.incidentAction.findFirst.mockResolvedValue(ACTION); // PROPOSED
    await expect(execute(ACTION.id)).rejects.toMatchObject({ status: 409 });
    expect(db.incidentAction.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an action outside the org", async () => {
    db.incidentAction.findFirst.mockResolvedValue(null);
    await expect(execute("action_missing")).rejects.toMatchObject({ status: 404 });
    // org isolation: the lookup is scoped through the incident relation
    expect(db.incidentAction.findFirst).toHaveBeenCalledWith({
      where: { id: "action_missing", incident: { orgId: ORG.id } },
    });
  });
});

describe("wired schemas", () => {
  it("proposedActionSchema requires findingId + title, defaults type/payload", () => {
    const ok = proposedActionSchema.safeParse({
      incidentId: INCIDENT.id,
      findingId: FINDING.id,
      title: "Claw back Apex overcharge",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.type).toBe("RECOMMENDATION");
      expect(ok.data.payload).toEqual({});
    }
    expect(
      proposedActionSchema.safeParse({ incidentId: INCIDENT.id, title: "Missing finding" }).success
    ).toBe(false);
    expect(
      proposedActionSchema.safeParse({
        incidentId: INCIDENT.id,
        findingId: FINDING.id,
        title: "Sh",
      }).success
    ).toBe(false);
  });

  it("approvalDecisionSchema allows omitting the decider (stub) and rejects bad decisions", () => {
    const ok = approvalDecisionSchema.safeParse({
      approvalId: APPROVAL.id,
      decision: "APPROVED",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.decidedById).toBeUndefined();
    expect(
      approvalDecisionSchema.safeParse({ approvalId: APPROVAL.id, decision: "MAYBE" }).success
    ).toBe(false);
  });

  it("approveRejectSchema omits approvalId (comes from the URL)", () => {
    const ok = approveRejectSchema.safeParse({ decision: "REJECTED", reason: "no" });
    expect(ok.success).toBe(true);
    expect(approveRejectSchema.safeParse({ reason: "no" }).success).toBe(false);
  });
});