// POST /api/connect/dodo/webhook — verify-first staging.
// The SDK-backed connector is mocked; prisma singleton is mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { db, verifyWebhook } = vi.hoisted(() => ({
  db: {
    user: { findFirst: vi.fn() },
    stagedRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
  verifyWebhook: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/connectors/dodo", () => ({
  DodoConnector: vi.fn(function (this: unknown) {
    return { verifyWebhook };
  }),
}));

import { POST as webhookPost } from "../app/api/connect/dodo/webhook/route";

const ORG_ID = "org_acme_industries";
const SESSION_USER = {
  id: "user_maya_chen",
  email: "maya.chen@acme.example",
  name: "Maya Chen",
  role: "CFO",
  orgId: ORG_ID,
};
const URL = "http://localhost/api/connect/dodo/webhook";

const RECORD = {
  externalId: "pay_wh_1",
  kind: "payment",
  occurredAt: new Date("2024-08-11T10:00:00.000Z"),
  currency: "INR",
  amount: 3590.4,
  customer: null,
  status: "succeeded",
  raw: { payment_id: "pay_wh_1" },
};

function post(body: string, headers: Record<string, string> = {}) {
  return webhookPost(
    new NextRequest(URL, { method: "POST", headers, body })
  );
}

describe("POST /api/connect/dodo/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.user.findFirst.mockResolvedValue(SESSION_USER);
    db.stagedRecord.findMany.mockResolvedValue([]);
  });

  it("stages a verified money event and audits it", async () => {
    verifyWebhook.mockResolvedValue({ ok: true, eventType: "payment.succeeded", record: RECORD });
    const res = await post(JSON.stringify({ type: "payment.succeeded" }), { "webhook-signature": "sig" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      received: true,
      staged: 1,
      skipped: 0,
      eventType: "payment.succeeded",
    });
    expect(db.stagedRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "connector.webhook", actorId: null }),
      })
    );
  });

  it("dedupes redelivered events", async () => {
    verifyWebhook.mockResolvedValue({ ok: true, eventType: "payment.succeeded", record: RECORD });
    db.stagedRecord.findMany.mockResolvedValue([{ kind: "payment", externalId: "pay_wh_1" }]);
    const res = await post(JSON.stringify({ type: "payment.succeeded" }));
    await expect(res.json()).resolves.toMatchObject({ received: true, staged: 0, skipped: 1 });
    expect(db.stagedRecord.createMany).not.toHaveBeenCalled();
  });

  it("acknowledges lifecycle noise without staging", async () => {
    verifyWebhook.mockResolvedValue({ ok: true, eventType: "subscription.renewed", record: null });
    const res = await post(JSON.stringify({ type: "subscription.renewed" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ received: true, staged: 0 });
    expect(db.stagedRecord.createMany).not.toHaveBeenCalled();
  });

  it("rejects tampered payloads with 401 and stages nothing", async () => {
    verifyWebhook.mockResolvedValue({ ok: false, error: "bad signature" });
    const res = await post(JSON.stringify({ type: "payment.succeeded" }));
    expect(res.status).toBe(401);
    expect(db.stagedRecord.createMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects empty bodies with 400", async () => {
    const res = await post("");
    expect(res.status).toBe(400);
    expect(verifyWebhook).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    db.user.findFirst.mockResolvedValue(null);
    verifyWebhook.mockResolvedValue({ ok: true, eventType: "payment.succeeded", record: RECORD });
    const res = await post(JSON.stringify({ type: "payment.succeeded" }));
    expect(res.status).toBe(401);
  });
});
