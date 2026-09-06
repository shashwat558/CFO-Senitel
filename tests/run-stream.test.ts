// GET /api/incidents/[id]/runs/[runId]/stream — SSE replay of one run.
//
// Covers the pure projector (buildRunEvents/toLoopStatus/formatSseEvent) plus
// the route: org scoping, cursor resume, single snapshot vs live-follow.
// The prisma singleton is mocked; everything else runs for real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildRunEvents,
  formatSseEvent,
  toLoopStatus,
} from "../lib/agent/runEvents";

const { db } = vi.hoisted(() => ({
  db: {
    user: { findFirst: vi.fn() },
    financialIncident: { findFirst: vi.fn() },
    agentRun: { findFirst: vi.fn() },
    agentStep: { findMany: vi.fn() },
    incidentEvidence: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { GET as streamGet } from "../app/api/incidents/[id]/runs/[runId]/stream/route";

const ORG_ID = "org_acme_industries";
const SESSION_USER = {
  id: "user_maya_chen",
  email: "maya.chen@acme.example",
  name: "Maya Chen",
  role: "CFO",
  orgId: ORG_ID,
};
const INCIDENT = { id: "incident_gm_aug2024", orgId: ORG_ID, title: "Gross margin decline" };
const T0 = new Date("2024-09-01T00:00:00.000Z");

const RUN = {
  id: "run_1",
  incidentId: INCIDENT.id,
  status: "COMPLETED",
  input: { question: "Why did gross margin fall in August?" },
  output: { answer: { summary: "Apex overcharge." }, iterations: 3, toolCallsExecuted: 2 },
  modelName: "investigator-loop",
  startedAt: T0,
};
const STEPS = [
  { seq: 1, toolName: null, status: "OK", reasoning: "plan: baseline first", startedAt: T0 },
  { seq: 2, toolName: "getPnl", status: "OK", reasoning: "tool getPnl succeeded", startedAt: T0 },
  { seq: 3, toolName: "compareVendorPrices", status: "ERROR", reasoning: "tool failed", startedAt: T0 },
  { seq: 4, toolName: "getContract", status: "RUNNING", reasoning: null, startedAt: T0 },
];
const EVIDENCE = [
  { id: "ev_old", toolName: "getPnl", summary: "stale", occurredAt: new Date(T0.getTime() - 1000) },
  { id: "ev_1", toolName: "getPnl", summary: "August P&L", occurredAt: new Date(T0.getTime() + 1000) },
  { id: "ev_2", toolName: "compareVendorPrices", summary: "Apex +28%", occurredAt: new Date(T0.getTime() + 2000) },
];

function mockDefaults() {
  db.user.findFirst.mockResolvedValue(SESSION_USER);
  db.financialIncident.findFirst.mockResolvedValue(INCIDENT);
  db.agentRun.findFirst.mockResolvedValue(RUN);
  db.agentStep.findMany.mockResolvedValue(STEPS);
  db.incidentEvidence.findMany.mockResolvedValue(EVIDENCE);
}

function parseSse(text: string): Array<{ id: string; event: string; data: unknown }> {
  return text
    .split("\n\n")
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !b.startsWith(":"))
    .map((b) => {
      const out: Record<string, string> = {};
      for (const line of b.split("\n")) {
        const i = line.indexOf(":");
        out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      return { id: out.id, event: out.event, data: JSON.parse(out.data) };
    });
}

describe("toLoopStatus", () => {
  it("maps persisted rows, including early-stop MAX_ITERATIONS", () => {
    expect(toLoopStatus("COMPLETED", {})).toBe("COMPLETED");
    expect(toLoopStatus("COMPLETED", { stopped: "MAX_ITERATIONS" })).toBe("MAX_ITERATIONS");
    expect(toLoopStatus("FAILED", {})).toBe("FAILED");
    expect(toLoopStatus("CANCELLED", {})).toBe("CANCELLED");
    expect(toLoopStatus("RUNNING", {})).toBe("FAILED");
  });
});

describe("buildRunEvents", () => {
  it("emits an ordered, id-stable projection", () => {
    const events = buildRunEvents({ run: RUN, steps: STEPS, evidence: EVIDENCE });
    expect(events.map((e) => e.id)).toEqual(events.map((_, i) => i + 1));
    expect(events.map((e) => e.type)).toEqual([
      "agent_started",
      "agent_step",
      "agent_step",
      "tool_completed",
      "agent_step",
      "tool_completed",
      "agent_step",
      "tool_started",
      "evidence_added",
      "evidence_added",
      "agent_finished",
    ]);
    // stale evidence (before run start) is excluded
    expect(events.filter((e) => e.type === "evidence_added").map((e) => (e.data as { id: string }).id)).toEqual([
      "ev_1",
      "ev_2",
    ]);
    expect(events[0].data).toMatchObject({ runId: "run_1", question: expect.stringContaining("August") });
    expect(events[events.length - 1]).toMatchObject({
      type: "agent_finished",
      data: expect.objectContaining({ status: "COMPLETED", iterations: 3, toolCallsExecuted: 2 }),
    });
  });

  it("omits agent_finished while the run is live", () => {
    const events = buildRunEvents({
      run: { ...RUN, status: "RUNNING", output: {} },
      steps: [],
      evidence: [],
    });
    expect(events.map((e) => e.type)).toEqual(["agent_started"]);
  });
});

describe("formatSseEvent", () => {
  it("serializes id/event/data frames", () => {
    expect(formatSseEvent({ id: 7, type: "agent_step", data: { seq: 2 } })).toBe(
      'id: 7\nevent: agent_step\ndata: {"seq":2}\n\n'
    );
  });
});

describe("GET stream route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  function get(url: string) {
    return streamGet(new NextRequest(url), {
      params: { id: INCIDENT.id, runId: "run_1" },
    });
  }

  it("returns a single SSE snapshot for a finished run", async () => {
    const res = await get(`http://localhost/api/incidents/${INCIDENT.id}/runs/run_1/stream?follow=0`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await res.text());
    expect(events[0]).toMatchObject({ id: "1", event: "agent_started" });
    expect(events[events.length - 1]).toMatchObject({ event: "agent_finished" });
    expect(events.map((e) => e.id)).toEqual(events.map((_, i) => String(i + 1)));
  });

  it("resumes after cursor", async () => {
    const res = await get(`http://localhost/api/incidents/${INCIDENT.id}/runs/run_1/stream?follow=0&cursor=2`);
    const events = parseSse(await res.text());
    expect(events[0].id).toBe("3");
  });

  it("404s unknown runs and cross-org incidents", async () => {
    db.agentRun.findFirst.mockResolvedValue(null);
    const missing = await get(`http://localhost/api/incidents/${INCIDENT.id}/runs/nope/stream?follow=0`);
    expect(missing.status).toBe(404);

    db.agentRun.findFirst.mockResolvedValue(RUN);
    db.financialIncident.findFirst.mockResolvedValue(null);
    const crossOrg = await get(`http://localhost/api/incidents/other/stream?follow=0`);
    expect(crossOrg.status).toBe(404);
  });

  it("401s without a session", async () => {
    db.user.findFirst.mockResolvedValue(null);
    const res = await get(`http://localhost/api/incidents/${INCIDENT.id}/runs/run_1/stream?follow=0`);
    expect(res.status).toBe(401);
  });

  it("follows a RUNNING run until it finishes, then closes", async () => {
    const running = { ...RUN, status: "RUNNING", output: {} };
    db.agentRun.findFirst
      .mockResolvedValueOnce(running) // initial lookup
      .mockResolvedValueOnce(running) // first poll: still running
      .mockResolvedValue(RUN); // second poll: completed
    const res = await get(
      `http://localhost/api/incidents/${INCIDENT.id}/runs/run_1/stream?follow=1&pollMs=250`
    );
    expect(res.status).toBe(200);
    const events = parseSse(await res.text());
    const finished = events.filter((e) => e.event === "agent_finished");
    expect(finished).toHaveLength(1);
    expect(finished[0].data).toMatchObject({ status: "COMPLETED" });
  }, 15000);
});
