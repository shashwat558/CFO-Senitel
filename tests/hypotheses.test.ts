import { describe, expect, it } from "vitest";
import {
  activeHypothesis,
  addContradictoryEvidence,
  addSupportingEvidence,
  assertHypothesisTransition,
  canTransitionHypothesis,
  createHypothesis,
  setConfidence,
  setHypothesisStatus,
  toIncidentFinding,
} from "../lib/agent/hypotheses";

describe("hypothesis management", () => {
  it("creates hypotheses as PROPOSED with default confidence", () => {
    const h = createHypothesis({ statement: "COGS increase caused margin decline." });
    expect(h.status).toBe("PROPOSED");
    expect(h.confidence).toBe(0.5);
    expect(h.id.length).toBeGreaterThan(0);
  });

  it("enforces the lifecycle PROPOSED -> INVESTIGATING -> SUPPORTED | REJECTED", () => {
    expect(canTransitionHypothesis("PROPOSED", "INVESTIGATING")).toBe(true);
    expect(canTransitionHypothesis("INVESTIGATING", "SUPPORTED")).toBe(true);
    expect(canTransitionHypothesis("INVESTIGATING", "REJECTED")).toBe(true);
    expect(canTransitionHypothesis("PROPOSED", "SUPPORTED")).toBe(false);
    expect(canTransitionHypothesis("SUPPORTED", "INVESTIGATING")).toBe(false);
    expect(() => assertHypothesisTransition("PROPOSED", "SUPPORTED")).toThrow(/Invalid hypothesis transition/);
    // overturn + reopen edges exist
    expect(canTransitionHypothesis("SUPPORTED", "REJECTED")).toBe(true);
    expect(canTransitionHypothesis("REJECTED", "INVESTIGATING")).toBe(true);
  });

  it("walks the example lifecycle: INVESTIGATING then SUPPORTED or REJECTED", () => {
    let h = createHypothesis({ statement: "COGS increase caused margin decline." });
    h = setHypothesisStatus(h, "INVESTIGATING");
    expect(h.status).toBe("INVESTIGATING");
    const supported = setHypothesisStatus(h, "SUPPORTED");
    expect(supported.status).toBe("SUPPORTED");
    const rejected = setHypothesisStatus(h, "REJECTED");
    expect(rejected.status).toBe("REJECTED");
  });

  it("records supporting and contradictory evidence with confidence nudges", () => {
    let h = createHypothesis({ statement: "Revenue leakage caused the decline." });
    h = addSupportingEvidence(h, "AR aging shows overdue invoices");
    expect(h.supportingEvidence).toEqual(["AR aging shows overdue invoices"]);
    expect(h.confidence).toBeCloseTo(0.6);
    h = addContradictoryEvidence(h, "AR collections hit record high");
    expect(h.contradictoryEvidence).toEqual(["AR collections hit record high"]);
    expect(h.confidence).toBeCloseTo(0.4);
    h = setConfidence(h, 0.9);
    expect(h.confidence).toBe(0.9);
    expect(() => setConfidence(h, 1.5)).toThrow();
  });

  it("selects the active hypothesis (newest INVESTIGATING, else newest PROPOSED)", () => {
    expect(activeHypothesis([])).toBeNull();
    const a = createHypothesis({ id: "a", statement: "Hypothesis A explanation." });
    const b = createHypothesis({ id: "b", statement: "Hypothesis B explanation." });
    expect(activeHypothesis([a, b])?.id).toBe("b");
    const bInv = setHypothesisStatus(b, "INVESTIGATING");
    expect(activeHypothesis([a, bInv])?.id).toBe("b");
    const bRej = setHypothesisStatus(bInv, "REJECTED");
    expect(activeHypothesis([a, bRej])?.id).toBe("a");
  });

  it("serializes to an IncidentFinding payload", () => {
    const h = createHypothesis({ statement: "COGS increase caused margin decline." });
    const row = toIncidentFinding(h, "inc1", 0);
    expect(row).toMatchObject({ incidentId: "inc1", rank: 0 });
    expect(row.title).toContain("COGS");
    expect(row.description).toContain("status=PROPOSED");
  });
});
