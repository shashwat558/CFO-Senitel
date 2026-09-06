// Verification runner — re-query getPnl/compareVendorPrices post-execution,
// mark the action VERIFIED/FAILED, and auto-advance the incident status
// (PENDING_APPROVAL → RESOLVED via phase edge VERIFY → RESOLVE, then
// RESOLVED → CLOSED on a subsequent verified action).
//
// The prisma singleton and the tool registry's executeTool are mocked; the
// transition logic (investigation-state) and the comparison run for real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { verifyAction, verifyAgainstFresh } from "../lib/verification/runner";

const { db, executeTool } = vi.hoisted(() => ({
  db: {
    incidentAction: { findFirst: vi.fn(), update: vi.fn() },
    incidentEvidence: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    financialIncident: { update: vi.fn() },
  },
  executeTool: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("../lib/tools/registry", () => ({ executeTool }));

const ORG = { id: "org_acme_industries", name: "Acme Industries" };
const FINDING_ID = "finding_apex";
const INCIDENT = { id: "incident_gm_aug2024", orgId: ORG.id, status: "PENDING_APPROVAL", resolvedAt: null };
const ACTION = {
  id: "action_clawback",
  incidentId: INCIDENT.id,
  title: "Claw back Apex overcharge",
  description: "",
  type: "RECOMMENDATION",
  status: "EXECUTED",
  payload: {
    findingId: FINDING_ID,
    verification: {
      toolName: "compareVendorPrices",
      input: {
        orgId: ORG.id,
        vendorId: "vendor_apex",
        startDate: "2024-08-01T00:00:00.000Z",
        endDate: "2024-09-01T00:00:00.000Z",
      },
      expected: { estimatedImpact: 78540, avgUnitPrice: 38.4 },
    },
  },
  simulationResult: { ok: true, engine: "stub" },
  verificationResult: null,
};

function mockDefaults() {
  db.incidentAction.findFirst.mockResolvedValue({ ...ACTION, incident: INCIDENT });
  db.incidentAction.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ ...ACTION, ...data })
  );
  db.incidentEvidence.create.mockResolvedValue({ id: "evidence_1" });
  db.auditLog.create.mockResolvedValue({ id: "audit_1" });
  db.financialIncident.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ ...INCIDENT, ...data })
  );
}

const verify = (actionId = ACTION.id) =>
  verifyAction(db as unknown as PrismaClient, ORG.id, actionId);

describe("verifyAgainstFresh", () => {
  it("passes when expected figures match fresh output", () => {
    expect(
      verifyAgainstFresh({ estimatedImpact: 78540, avgUnitPrice: 38.4 }, { estimatedImpact: 78540, avgUnitPrice: 38.4 })
    ).toEqual({ ok: true, detail: "" });
  });

  it("tolerates 0.01 rounding (money is rounded to 2dp)", () => {
    expect(verifyAgainstFresh({ grossMargin: 30 }, { grossMargin: 29.99 })).toEqual({ ok: true, detail: "" });
    expect(verifyAgainstFresh({ grossMargin: 30 }, { grossMargin: 29.98 })).toMatchObject({ ok: false });
  });

  it("fails on missing or mismatched keys", () => {
    expect(verifyAgainstFresh({ estimatedImpact: 78540 }, { avgUnitPrice: 38.4 })).toMatchObject({
      ok: false,
      detail: expect.stringContaining("estimatedImpact is missing"),
    });
    expect(verifyAgainstFresh({ estimatedImpact: 80000 }, { estimatedImpact: 78540 })).toMatchObject({
      ok: false,
      detail: expect.stringContaining("estimatedImpact mismatch"),
    });
  });

  it("compares nested objects and arrays element-wise", () => {
    const fresh = {
      vendor: { id: "v1", name: "Apex Steel" },
      invoices: [{ invoiceNumber: "INV-1", total: 1200 }, { invoiceNumber: "INV-2", total: 900 }],
    };
    expect(verifyAgainstFresh({ vendor: { name: "Apex Steel" } }, fresh)).toMatchObject({ ok: true });
    expect(
      verifyAgainstFresh({ invoices: [{ total: 1200 }, { total: 901 }] }, fresh)
    ).toMatchObject({ ok: false, detail: expect.stringContaining("invoices[1]") });
  });

  it("rejects a non-object fresh output", () => {
    expect(verifyAgainstFresh({ a: 1 }, "nope")).toMatchObject({ ok: false });
  });
});

describe("verifyAction — post-execution verification runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
    executeTool.mockResolvedValue({
      estimatedImpact: 78540,
      avgUnitPrice: 38.4,
      invoiceCount: 6,
    });
  });

  it("pass: re-queries compareVendorPrices, marks VERIFIED, auto-resolves the incident", async () => {
    const { result, action, incident } = await verify();

    expect(result.verified).toBe(true);
    expect(result.actionId).toBe(ACTION.id);
    expect(result.checkedAt).toEqual(expect.any(String));
    expect(result.detail).toMatch(/fresh tool output matches/);

    // the tool is re-queried with the original input against fresh DB state
    expect(executeTool).toHaveBeenCalledWith("compareVendorPrices", ACTION.payload.verification.input, {
      db,
      orgId: ORG.id,
      audit: true,
    });

    expect(db.incidentAction.update).toHaveBeenCalledWith({
      where: { id: ACTION.id },
      data: { status: "VERIFIED", verificationResult: result },
    });

    // evidence records the re-query, linked to the originating finding
    expect(db.incidentEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        incidentId: INCIDENT.id,
        findingId: FINDING_ID,
        toolName: "compareVendorPrices",
        output: expect.objectContaining({ verification: result }),
        summary: expect.stringContaining("post-execution verification passed"),
      }),
    });

    // audit
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG.id,
        action: "action.verify",
        entityType: "IncidentAction",
        entityId: ACTION.id,
        metadata: expect.objectContaining({ status: "VERIFIED", verified: true }),
      }),
    });

    // auto-transition: PENDING_APPROVAL → RESOLVED (phase edge VERIFY → RESOLVE)
    expect(db.financialIncident.update).toHaveBeenCalledWith({
      where: { id: INCIDENT.id },
      data: expect.objectContaining({ status: "RESOLVED", resolvedAt: expect.any(Date) }),
    });
    expect(action.status).toBe("VERIFIED");
    expect(incident.status).toBe("RESOLVED");
  });

  it("pass on getPnl: the second verifiable tool is re-queried too", async () => {
    executeTool.mockResolvedValue({ revenue: 1000, cogs: 700, grossProfit: 300, grossMargin: 29.99 });
    db.incidentAction.findFirst.mockResolvedValue({
      ...ACTION,
      payload: {
        findingId: FINDING_ID,
        verification: {
          toolName: "getPnl",
          input: { orgId: ORG.id, year: 2024, month: 8 },
          expected: { grossProfit: 300, grossMargin: 30 },
        },
      },
      incident: INCIDENT,
    });
    const { result } = await verify();
    expect(result.verified).toBe(true);
    expect(executeTool).toHaveBeenCalledWith(
      "getPnl",
      { orgId: ORG.id, year: 2024, month: 8 },
      expect.objectContaining({ orgId: ORG.id, audit: true })
    );
    expect(db.incidentEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ toolName: "getPnl" }),
    });
  });

  it("fail: fresh figures no longer match → FAILED, incident untouched", async () => {
    executeTool.mockResolvedValue({ estimatedImpact: 88400, avgUnitPrice: 38.4, invoiceCount: 6 });
    const { result, action, incident } = await verify();

    expect(result.verified).toBe(false);
    expect(result.detail).toMatch(/estimatedImpact mismatch/);
    expect(db.incidentAction.update).toHaveBeenCalledWith({
      where: { id: ACTION.id },
      data: { status: "FAILED", verificationResult: result },
    });
    expect(db.financialIncident.update).not.toHaveBeenCalled();
    expect(action.status).toBe("FAILED");
    expect(incident.status).toBe("PENDING_APPROVAL");
  });

  it("fail: missing verification instruction → FAILED without re-querying", async () => {
    db.incidentAction.findFirst.mockResolvedValue({
      ...ACTION,
      payload: { findingId: FINDING_ID },
      incident: INCIDENT,
    });
    const { result } = await verify();
    expect(result.verified).toBe(false);
    expect(result.detail).toMatch(/no verification instruction/);
    expect(executeTool).not.toHaveBeenCalled();
    expect(db.incidentAction.update).toHaveBeenCalledWith({
      where: { id: ACTION.id },
      data: { status: "FAILED", verificationResult: result },
    });
  });

  it("fail: invalid verification instruction (bad tool) → FAILED, no re-query", async () => {
    db.incidentAction.findFirst.mockResolvedValue({
      ...ACTION,
      payload: { findingId: FINDING_ID, verification: { toolName: "getVendorSpend", input: {} } },
      incident: INCIDENT,
    });
    const { result } = await verify();
    expect(result.verified).toBe(false);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("fail: re-query throws → FAILED with the tool error surfaced", async () => {
    executeTool.mockRejectedValue(new Error("orgId does not match tool context"));
    const { result } = await verify();
    expect(result.verified).toBe(false);
    expect(result.detail).toMatch(/re-query failed: orgId does not match/);
    expect(db.financialIncident.update).not.toHaveBeenCalled();
  });

  it("second verified action auto-closes an already-RESOLVED incident", async () => {
    db.incidentAction.findFirst.mockResolvedValue({
      ...ACTION,
      incident: { ...INCIDENT, status: "RESOLVED", resolvedAt: new Date("2024-09-05T00:00:00.000Z") },
    });
    const { incident } = await verify();
    expect(db.financialIncident.update).toHaveBeenCalledWith({
      where: { id: INCIDENT.id },
      data: { status: "CLOSED" },
    });
    expect(incident.status).toBe("CLOSED");
  });

  it("does not transition the incident from OPEN/INVESTIGATING (no legal phase edge)", async () => {
    db.incidentAction.findFirst.mockResolvedValue({ ...ACTION, incident: { ...INCIDENT, status: "INVESTIGATING" } });
    const { result, incident } = await verify();
    expect(result.verified).toBe(true);
    expect(db.financialIncident.update).not.toHaveBeenCalled();
    expect(incident.status).toBe("INVESTIGATING");
  });

  it("refuses to verify anything but an EXECUTED action (409)", async () => {
    db.incidentAction.findFirst.mockResolvedValue({ ...ACTION, status: "APPROVED", incident: INCIDENT });
    const outcome = await verify().then(
      (ok) => ok,
      (e) => ({ error: e })
    );
    expect(outcome).toMatchObject({ error: { status: 409 } });
    expect(db.incidentAction.update).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("returns 404 for an action outside the org", async () => {
    db.incidentAction.findFirst.mockResolvedValue(null);
    const res = await verify("action_missing").then(
      (ok) => ok,
      (e) => ({ error: e })
    );
    expect(res).toMatchObject({ error: { status: 404 } });
    expect(db.incidentAction.findFirst).toHaveBeenCalledWith({
      where: { id: "action_missing", incident: { orgId: ORG.id } },
      include: { incident: true },
    });
  });
});