import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  assertFindingTransition,
  canTransitionFinding,
  createFinding,
  fromIncidentFindingRow,
  linkAgentStep,
  recordFinding,
  setFindingConfidence,
  setFindingImpact,
  setFindingStatus,
  toIncidentFindingRow,
  updateFindingRow,
} from "../lib/agent/findings";

describe("finding creation", () => {
  it("creates findings with statement/type/status/impact/confidence/incident", () => {
    const f = createFinding({
      incidentId: "inc1",
      statement: "COGS overcharge of 78540 caused the margin decline.",
      type: "ROOT_CAUSE",
      status: "SUPPORTED",
      impact: { monetaryAmount: 78540, currency: "USD", description: "August overcharge" },
      confidence: 0.85,
      agentStepId: "step_3",
    });
    expect(f).toMatchObject({
      incidentId: "inc1",
      type: "ROOT_CAUSE",
      status: "SUPPORTED",
      confidence: 0.85,
      agentStepId: "step_3",
    });
    expect(f.impact.monetaryAmount).toBe(78540);
  });

  it("defaults to HYPOTHESIS status with empty impact", () => {
    const f = createFinding({ incidentId: "inc1", statement: "Revenue may have leaked somewhere." });
    expect(f.status).toBe("HYPOTHESIS");
    expect(f.impact.monetaryAmount).toBeNull();
  });

  it("enforces the finding lifecycle incl. VALIDATED and UNKNOWN", () => {
    expect(canTransitionFinding("HYPOTHESIS", "INVESTIGATING")).toBe(true);
    expect(canTransitionFinding("INVESTIGATING", "SUPPORTED")).toBe(true);
    expect(canTransitionFinding("SUPPORTED", "VALIDATED")).toBe(true);
    expect(canTransitionFinding("INVESTIGATING", "REJECTED")).toBe(true);
    expect(canTransitionFinding("HYPOTHESIS", "VALIDATED")).toBe(false);
    expect(canTransitionFinding("VALIDATED", "SUPPORTED")).toBe(false);
    expect(canTransitionFinding("REJECTED", "INVESTIGATING")).toBe(true);
    expect(() => assertFindingTransition("HYPOTHESIS", "VALIDATED")).toThrow(/Invalid finding transition/);

    let f = createFinding({ incidentId: "inc1", statement: "COGS overcharge drove the decline." });
    f = setFindingStatus(f, "INVESTIGATING");
    f = setFindingStatus(f, "SUPPORTED");
    f = setFindingStatus(f, "VALIDATED");
    expect(f.status).toBe("VALIDATED");
  });

  it("updates impact, confidence, and the agent step link", () => {
    let f = createFinding({ incidentId: "inc1", statement: "Vendor overcharged in August." });
    f = setFindingImpact(f, { monetaryAmount: 78540, description: "August" });
    expect(f.impact).toMatchObject({ monetaryAmount: 78540, currency: "USD", description: "August" });
    f = setFindingConfidence(f, 0.9);
    expect(f.confidence).toBe(0.9);
    expect(() => setFindingConfidence(f, 2)).toThrow();
    f = linkAgentStep(f, "step_7");
    expect(f.agentStepId).toBe("step_7");
  });

  it("round-trips through an IncidentFinding row", () => {
    const f = linkAgentStep(
      createFinding({
        incidentId: "inc1",
        statement: "COGS overcharge caused the decline.",
        type: "ROOT_CAUSE",
        status: "SUPPORTED",
        impact: { monetaryAmount: 78540, currency: "USD", description: "Aug" },
        confidence: 0.8,
      }),
      "step_4",
    );
    const row = toIncidentFindingRow(f, 0);
    expect(row.incidentId).toBe("inc1");
    expect(row.title).toContain("COGS");
    const back = fromIncidentFindingRow({ ...row, id: "row_1", confidence: 0.8 });
    expect(back).toMatchObject({
      id: "row_1",
      statement: f.statement,
      type: "ROOT_CAUSE",
      status: "SUPPORTED",
      confidence: 0.8,
      agentStepId: "step_4",
    });
    expect(back.impact.monetaryAmount).toBe(78540);
  });

  it("falls back to UNKNOWN for legacy plain-text rows", () => {
    const back = fromIncidentFindingRow({
      id: "row_9",
      incidentId: "inc1",
      title: "legacy title",
      description: "status=SUPPORTED supporting=1 contradictory=0",
      confidence: 0.3,
    });
    expect(back.status).toBe("UNKNOWN");
    expect(back.statement).toBe("legacy title");
    expect(back.agentStepId).toBeNull();
  });

  it("records and updates rows via Prisma", async () => {
    const db = {
      incidentFinding: {
        create: vi.fn().mockResolvedValue({ id: "row_1" }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;
    const f = createFinding({ incidentId: "inc1", statement: "Overcharge confirmed by invoices." });
    await expect(recordFinding(db, f, 0)).resolves.toBe("row_1");
    expect(db.incidentFinding.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ incidentId: "inc1" }) }),
    );
    await updateFindingRow(db, "row_1", setFindingStatus(f, "INVESTIGATING"), 0);
    expect(db.incidentFinding.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row_1" } }),
    );
  });
});
