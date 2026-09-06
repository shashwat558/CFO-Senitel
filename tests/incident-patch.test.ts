// PATCH /api/incidents/[id] — status transition
//   OPEN → INVESTIGATING → PENDING_APPROVAL → RESOLVED/CLOSED
// (reusing investigation-state edges; invalid moves → 400 ValidationError)
// plus assignment to an org user. The prisma singleton is mocked; the
// incident-status state machine and service validation run for real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { db } = vi.hoisted(() => ({
  db: {
    financialIncident: { findFirst: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { PATCH as patchIncident } from "../app/api/incidents/[id]/route";

const ORG = { id: "org_acme_industries", name: "Acme Industries", slug: "acme-industries" };
const INCIDENT = {
  id: "incident_gm_aug2024",
  orgId: ORG.id,
  title: "Gross margin decline",
  status: "OPEN",
  resolvedAt: null,
  assignedToId: null,
};
const SESSION_USER = {
  id: "user_maya_chen",
  email: "maya.chen@acme.example",
  name: "Maya Chen",
  role: "CFO",
  orgId: ORG.id,
};
const USER_CONTROLLER = { id: "user_okafor", orgId: ORG.id, role: "CONTROLLER", name: "David Okafor" };

function mockDefaults() {
  db.financialIncident.findFirst.mockResolvedValue(INCIDENT);
  db.financialIncident.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ ...INCIDENT, ...data })
  );
  // Session resolution (getSession: findFirst WITHOUT orgId → the seeded
  // default user, Maya Chen), while assignee lookups (findFirst WITH orgId)
  // resolve to an org user.
  db.user.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(where.orgId ? USER_CONTROLLER : SESSION_USER)
  );
  db.auditLog.create.mockResolvedValue({});
}

function patch(body: unknown, id = INCIDENT.id) {
  return patchIncident(
    new NextRequest(`http://localhost/api/incidents/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: { id } }
  );
}

describe("PATCH /api/incidents/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("transitions OPEN → INVESTIGATING and audits the status move", async () => {
    const res = await patch({ status: "INVESTIGATING" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "INVESTIGATING" });

    expect(db.financialIncident.update).toHaveBeenCalledWith({
      where: { id: INCIDENT.id },
      data: { status: "INVESTIGATING" },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG.id,
        actorId: SESSION_USER.id,
        action: "incident.status",
        entityType: "FinancialIncident",
        entityId: INCIDENT.id,
        metadata: { from: "OPEN", to: "INVESTIGATING" },
      }),
    });
  });

  it("walks straight to RESOLVED from PENDING_APPROVAL and stamps resolvedAt", async () => {
    db.financialIncident.findFirst.mockResolvedValue({ ...INCIDENT, status: "PENDING_APPROVAL" });
    const res = await patch({ status: "RESOLVED" });
    expect(res.status).toBe(200);
    expect(db.financialIncident.update).toHaveBeenCalledWith({
      where: { id: INCIDENT.id },
      data: expect.objectContaining({ status: "RESOLVED", resolvedAt: expect.any(Date) }),
    });
  });

  it("closes a RESOLVED incident", async () => {
    db.financialIncident.findFirst.mockResolvedValue({ ...INCIDENT, status: "RESOLVED" });
    const res = await patch({ status: "CLOSED" });
    expect(res.status).toBe(200);
    expect(db.financialIncident.update).toHaveBeenCalledWith({
      where: { id: INCIDENT.id },
      data: { status: "CLOSED" },
    });
  });

  it("rejects an invalid transition (OPEN → RESOLVED) with 400 ValidationError", async () => {
    const res = await patch({ status: "RESOLVED" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("invalid incident transition: OPEN -> RESOLVED") });
    expect(db.financialIncident.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects backwards moves (INVESTIGATING → OPEN) with 400", async () => {
    db.financialIncident.findFirst.mockResolvedValue({ ...INCIDENT, status: "INVESTIGATING" });
    const res = await patch({ status: "OPEN" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown status string with 400 before any write", async () => {
    const res = await patch({ status: "DONE" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("invalid incident update") });
    expect(db.financialIncident.update).not.toHaveBeenCalled();
  });

  it("rejects an empty body with 400", async () => {
    const res = await patch({});
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("provide at least one") });
  });

  it("assigns the incident to an org user and audits incident.assign", async () => {
    const res = await patch({ assignedToId: USER_CONTROLLER.id });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ assignedToId: USER_CONTROLLER.id });

    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: USER_CONTROLLER.id, orgId: ORG.id },
      select: { id: true },
    });
    expect(db.financialIncident.update).toHaveBeenCalledWith({
      where: { id: INCIDENT.id },
      data: { assignedToId: USER_CONTROLLER.id },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "incident.assign",
        metadata: { assignedToId: USER_CONTROLLER.id },
      }),
    });
  });

  it("combines status + assignment in one update, audited as incident.update", async () => {
    const res = await patch({ status: "INVESTIGATING", assignedToId: USER_CONTROLLER.id });
    expect(res.status).toBe(200);
    expect(db.financialIncident.update).toHaveBeenCalledWith({
      where: { id: INCIDENT.id },
      data: { status: "INVESTIGATING", assignedToId: USER_CONTROLLER.id },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "incident.update",
        metadata: { from: "OPEN", to: "INVESTIGATING", assignedToId: USER_CONTROLLER.id },
      }),
    });
  });

  it("returns 404 when the assignee is not an org user", async () => {
    // Session still resolves (findFirst without orgId); the assignee lookup
    // (findFirst with orgId) misses → the assignee is invisible to this org.
    db.user.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.orgId ? null : SESSION_USER)
    );
    const res = await patch({ assignedToId: "user_ghost" });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("assignee not found") });
    expect(db.financialIncident.update).not.toHaveBeenCalled();
  });

  it("returns 401 when no session user exists (seed not run)", async () => {
    db.user.findFirst.mockResolvedValue(null);
    const res = await patch({ status: "INVESTIGATING" });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("no default user") });
    expect(db.financialIncident.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an incident outside the org", async () => {
    db.financialIncident.findFirst.mockResolvedValue(null);
    const res = await patch({ status: "INVESTIGATING" });
    expect(res.status).toBe(404);
    expect(db.financialIncident.update).not.toHaveBeenCalled();
  });

  it("is idempotent on the same status (200, no write)", async () => {
    const res = await patch({ status: "OPEN" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "OPEN" });
    expect(db.financialIncident.update).not.toHaveBeenCalled();
  });

  it("strips unknown body fields (Zod default strip), tolerating extra keys", async () => {
    const res = await patch({ status: "INVESTIGATING", surprise: true });
    expect(res.status).toBe(200);
    expect(db.financialIncident.update).toHaveBeenCalledWith({
      where: { id: INCIDENT.id },
      data: { status: "INVESTIGATING" },
    });
  });
});