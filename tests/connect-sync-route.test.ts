// /api/connect/sync routes: POST tick + GET ledger.
// The scheduler is mocked; prisma singleton is mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { rdb, runScheduledSyncMock } = vi.hoisted(() => ({
  rdb: {
    user: { findFirst: vi.fn() },
    syncRun: { findMany: vi.fn().mockResolvedValue([]) },
  },
  runScheduledSyncMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: rdb }));
vi.mock("@/lib/connectors/scheduler", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/connectors/scheduler")>();
  return { ...mod, runScheduledSync: runScheduledSyncMock };
});

import { GET as syncGet, POST as syncPost } from "../app/api/connect/sync/route";

const ORG = "org_acme_industries";
const SESSION_USER = {
  id: "user_maya_chen",
  email: "maya.chen@acme.example",
  name: "Maya Chen",
  role: "CFO",
  orgId: ORG,
};
const SYNC_URL = "http://localhost/api/connect/sync";
const AT = new Date("2024-08-11T10:00:00.000Z");

describe("POST /api/connect/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rdb.user.findFirst.mockResolvedValue(SESSION_USER);
  });

  it("runs a tick and returns the combined summary", async () => {
    runScheduledSyncMock.mockResolvedValue({
      provider: "dodo",
      pull: { pulled: 2, staged: 2, skipped: 0, cursor: AT, counts: { payment: 1, payout: 1 } },
      promote: { promoted: 2, rejected: 0, details: [] },
    });
    const res = await syncPost(
      new NextRequest(SYNC_URL, { method: "POST", body: JSON.stringify({}) })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      orgId: ORG,
      provider: "dodo",
      pulled: 2,
      staged: 2,
      promoted: 2,
      rejected: 0,
    });
    expect(runScheduledSyncMock).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.objectContaining({ provider: "dodo", actorId: SESSION_USER.id })
    );
  });

  it("rejects unknown providers with 400 before touching the connector", async () => {
    const res = await syncPost(
      new NextRequest(SYNC_URL, { method: "POST", body: JSON.stringify({ provider: "xero" }) })
    );
    expect(res.status).toBe(400);
    expect(runScheduledSyncMock).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    rdb.user.findFirst.mockResolvedValue(null);
    const res = await syncPost(new NextRequest(SYNC_URL, { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/connect/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rdb.user.findFirst.mockResolvedValue(SESSION_USER);
  });

  it("lists recent ledger rows org-scoped", async () => {
    rdb.syncRun.findMany.mockResolvedValue([{ id: "sync_1", status: "COMPLETED" }]);
    const res = await syncGet(new NextRequest(`${SYNC_URL}?limit=5`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ orgId: ORG });
    expect(rdb.syncRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: ORG }, take: 5 })
    );
  });
});
