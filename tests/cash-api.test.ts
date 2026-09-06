// Cash UI data routes:
//   GET /api/cash/forecast
//   GET /api/cash/aging?side=ar|ap
// Prisma singleton is mocked; services run for real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { db } = vi.hoisted(() => ({
  db: {
    user: { findFirst: vi.fn() },
    bankAccount: { findMany: vi.fn().mockResolvedValue([]) },
    bankTransaction: { findMany: vi.fn().mockResolvedValue([]) },
    invoice: { findMany: vi.fn().mockResolvedValue([]) },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    forecast: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { GET as forecastGet } from "../app/api/cash/forecast/route";
import { GET as agingGet } from "../app/api/cash/aging/route";

const ORG_ID = "org_acme_industries";
const SESSION_USER = {
  id: "user_maya_chen",
  email: "maya.chen@acme.example",
  name: "Maya Chen",
  role: "CFO",
  orgId: ORG_ID,
};

function mockDefaults() {
  db.user.findFirst.mockResolvedValue(SESSION_USER);
}

describe("GET /api/cash/forecast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("returns weeks with a shortfall figure", async () => {
    const res = await forecastGet(new NextRequest("http://localhost/api/cash/forecast?weeks=4"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { weeks: unknown[]; shortfall: number; orgId: string };
    expect(body.orgId).toBe(ORG_ID);
    expect(body.weeks).toHaveLength(4);
    expect(typeof body.shortfall).toBe("number");
  });

  it("400s invalid weeks", async () => {
    const res = await forecastGet(new NextRequest("http://localhost/api/cash/forecast?weeks=99"));
    expect(res.status).toBe(400);
  });

  it("401s without a session", async () => {
    db.user.findFirst.mockResolvedValue(null);
    const res = await forecastGet(new NextRequest("http://localhost/api/cash/forecast"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cash/aging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  it("returns AR buckets by default", async () => {
    db.invoice.findMany.mockResolvedValue([
      {
        invoiceNumber: "AR-1",
        customer: { name: "Big Co" },
        vendor: null,
        issueDate: new Date("2024-12-10T00:00:00Z"),
        dueDate: new Date("2025-01-10T00:00:00Z"),
        total: 100,
      },
    ]);
    const res = await agingGet(new NextRequest("http://localhost/api/cash/aging?side=ar"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { side: string; total: number };
    expect(body.side).toBe("ar");
    expect(body.total).toBe(100);
  });

  it("400s unknown sides and bad dates", async () => {
    const badSide = await agingGet(new NextRequest("http://localhost/api/cash/aging?side=xx"));
    expect(badSide.status).toBe(400);
    const badDate = await agingGet(new NextRequest("http://localhost/api/cash/aging?side=ap&asOf=nope"));
    expect(badDate.status).toBe(400);
  });

  it("401s without a session", async () => {
    db.user.findFirst.mockResolvedValue(null);
    const res = await agingGet(new NextRequest("http://localhost/api/cash/aging"));
    expect(res.status).toBe(401);
  });
});
