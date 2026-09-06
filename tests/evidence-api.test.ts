// Evidence lineage APIs:
//   GET /api/incidents/[id]/evidence (filters + pagination)
//   GET /api/incidents/[id]/evidence/[evidenceId] (?expand=source)
// plus the service layer: record validation, org scoping, source resolution.
//
// The prisma singleton is mocked; services/validation run for real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  getEvidenceDetail,
  listEvidence,
  recordEvidence,
  resolveEvidenceSource,
} from "../lib/evidence/service";

const { db } = vi.hoisted(() => ({
  db: {
    user: { findFirst: vi.fn() },
    financialIncident: { findFirst: vi.fn() },
    incidentEvidence: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    invoice: { findFirst: vi.fn() },
    contract: { findFirst: vi.fn() },
    purchaseOrder: { findFirst: vi.fn() },
    transaction: { findFirst: vi.fn() },
    journalEntry: { findFirst: vi.fn() },
    bankTransaction: { findFirst: vi.fn() },
    forecast: { findFirst: vi.fn() },
    budget: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { GET as listGet } from "../app/api/incidents/[id]/evidence/route";
import { GET as detailGet } from "../app/api/incidents/[id]/evidence/[evidenceId]/route";

const ORG_ID = "org_acme_industries";
const SESSION_USER = {
  id: "user_maya_chen",
  email: "maya.chen@acme.example",
  name: "Maya Chen",
  role: "CFO",
  orgId: ORG_ID,
};
const INCIDENT = { id: "incident_gm_aug2024", orgId: ORG_ID, title: "Gross margin decline" };
const EV = {
  id: "ev_1",
  incidentId: INCIDENT.id,
  toolName: "compareVendorPrices",
  summary: "Apex +28% vs contract",
  sourceType: "INVOICE",
  sourceId: "inv_1",
  relevance: 0.9,
  confidence: 0.8,
};
const baseUrl = `http://localhost/api/incidents/${INCIDENT.id}/evidence`;

function mockDefaults() {
  db.user.findFirst.mockResolvedValue(SESSION_USER);
  db.financialIncident.findFirst.mockResolvedValue(INCIDENT);
  db.incidentEvidence.count.mockResolvedValue(1);
  db.incidentEvidence.findMany.mockResolvedValue([EV]);
  db.incidentEvidence.findFirst.mockResolvedValue(EV);
  db.incidentEvidence.create.mockImplementation((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "ev_new", ...args.data })
  );
}

describe("recordEvidence service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("persists typed lineage fields", async () => {
    const row = (await recordEvidence(db as never, {
      incidentId: INCIDENT.id,
      toolName: "getContract",
      summary: "Contract allows 3%",
      sourceType: "CONTRACT",
      sourceId: "ctr_1",
      relevance: 0.7,
    })) as { sourceType: string; sourceId: string; relevance: number; confidence: null };
    expect(db.incidentEvidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceType: "CONTRACT", sourceId: "ctr_1", relevance: 0.7, confidence: null }),
      })
    );
    expect(row.sourceId).toBe("ctr_1");
  });

  it("rejects empty summaries and half-specified sources with 400", async () => {
    await expect(
      recordEvidence(db as never, { incidentId: "i", toolName: "t", summary: "" })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      recordEvidence(db as never, { incidentId: "i", toolName: "t", summary: "s", sourceType: "INVOICE" })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      recordEvidence(db as never, { incidentId: "i", toolName: "t", summary: "s", relevance: 2 })
    ).rejects.toMatchObject({ status: 400 });
    expect(db.incidentEvidence.create).not.toHaveBeenCalled();
  });
});

describe("resolveEvidenceSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("resolves model-backed sources org-scoped", async () => {
    db.invoice.findFirst.mockResolvedValue({ id: "inv_1", total: 100 });
    const out = await resolveEvidenceSource(db as never, ORG_ID, {
      sourceType: "INVOICE",
      sourceId: "inv_1",
    });
    expect(db.invoice.findFirst).toHaveBeenCalledWith({ where: { id: "inv_1", orgId: ORG_ID } });
    expect(out).toMatchObject({ kind: "INVOICE", row: { id: "inv_1" } });
  });

  it("returns null + reason for unmodeled kinds and missing rows", async () => {
    const unmodeled = await resolveEvidenceSource(db as never, ORG_ID, {
      sourceType: "DOCUMENT",
      sourceId: "doc_1",
    });
    expect(unmodeled).toMatchObject({ kind: "DOCUMENT", row: null });

    db.contract.findFirst.mockResolvedValue(null);
    const missing = await resolveEvidenceSource(db as never, ORG_ID, {
      sourceType: "CONTRACT",
      sourceId: "ctr_nope",
    });
    expect(missing).toMatchObject({ kind: "CONTRACT", row: null, reason: expect.any(String) });
  });

  it("resolves bank, forecast, and budget sources org-scoped", async () => {
    db.bankTransaction.findFirst.mockResolvedValue({ id: "bt_1", amount: -40000 });
    db.forecast.findFirst.mockResolvedValue({ id: "fc_1", amount: 1240000 });
    db.budget.findFirst.mockResolvedValue({ id: "bud_1", amount: 700000 });
    await expect(
      resolveEvidenceSource(db as never, ORG_ID, { sourceType: "BANK_TRANSACTION", sourceId: "bt_1" })
    ).resolves.toMatchObject({ kind: "BANK_TRANSACTION", row: { id: "bt_1" } });
    await expect(
      resolveEvidenceSource(db as never, ORG_ID, { sourceType: "FORECAST", sourceId: "fc_1" })
    ).resolves.toMatchObject({ kind: "FORECAST", row: { id: "fc_1" } });
    await expect(
      resolveEvidenceSource(db as never, ORG_ID, { sourceType: "BUDGET", sourceId: "bud_1" })
    ).resolves.toMatchObject({ kind: "BUDGET", row: { id: "bud_1" } });
    expect(db.bankTransaction.findFirst).toHaveBeenCalledWith({ where: { id: "bt_1", orgId: ORG_ID } });
  });

  it("returns null when the row carries no lineage", async () => {
    await expect(
      resolveEvidenceSource(db as never, ORG_ID, { sourceType: null, sourceId: null })
    ).resolves.toBeNull();
  });
});

describe("listEvidence service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("scopes to the incident and forwards filters", async () => {
    const out = await listEvidence(db as never, ORG_ID, INCIDENT.id, {
      page: 1,
      pageSize: 20,
      toolName: "compareVendorPrices",
    });
    expect(out.total).toBe(1);
    expect(db.incidentEvidence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ incidentId: INCIDENT.id, toolName: "compareVendorPrices" }),
      })
    );
  });

  it("404s cross-org incidents", async () => {
    db.financialIncident.findFirst.mockResolvedValue(null);
    await expect(listEvidence(db as never, ORG_ID, "other", {})).rejects.toMatchObject({ status: 404 });
  });
});

describe("GET evidence routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("lists evidence with counts", async () => {
    const res = await listGet(new NextRequest(`${baseUrl}?toolName=compareVendorPrices`), {
      params: { id: INCIDENT.id },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; items: unknown[] };
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
  });

  it("expands the source row on detail", async () => {
    db.invoice.findFirst.mockResolvedValue({ id: "inv_1", total: 359040 });
    const res = await detailGet(new NextRequest(`${baseUrl}/ev_1?expand=source`), {
      params: { id: INCIDENT.id, evidenceId: "ev_1" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: { kind: string; row: { total: number } } };
    expect(body.source).toMatchObject({ kind: "INVOICE", row: { total: 359040 } });
  });

  it("omits source without expand and 404s unknown rows", async () => {
    const plain = await detailGet(new NextRequest(`${baseUrl}/ev_1`), {
      params: { id: INCIDENT.id, evidenceId: "ev_1" },
    });
    expect(plain.status).toBe(200);
    expect((await plain.json()) as Record<string, unknown>).not.toHaveProperty("source");

    db.incidentEvidence.findFirst.mockResolvedValue(null);
    const missing = await detailGet(new NextRequest(`${baseUrl}/nope`), {
      params: { id: INCIDENT.id, evidenceId: "nope" },
    });
    expect(missing.status).toBe(404);
  });

  it("401s without a session", async () => {
    db.user.findFirst.mockResolvedValue(null);
    const res = await listGet(new NextRequest(baseUrl), { params: { id: INCIDENT.id } });
    expect(res.status).toBe(401);
  });
});

describe("getEvidenceDetail scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("never leaks rows across incidents", async () => {
    db.incidentEvidence.findFirst.mockResolvedValue(null);
    await expect(getEvidenceDetail(db as never, ORG_ID, INCIDENT.id, "ev_other", {})).rejects.toMatchObject({
      status: 404,
    });
    expect(db.incidentEvidence.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ev_other", incidentId: INCIDENT.id } })
    );
  });
});
