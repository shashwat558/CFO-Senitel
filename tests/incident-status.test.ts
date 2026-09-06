// Incident status lifecycle — reuses the investigation phase transitions:
//   OPEN → INVESTIGATING → PENDING_APPROVAL → RESOLVED → CLOSED
//   (PENDING_APPROVAL → CLOSED closes without approving)
// VERIFY → RESOLVE is the phase edge that resolves an incident.

import { describe, expect, it } from "vitest";
import {
  assertTransitionIncidentStatus,
  canTransitionIncidentStatus,
  INCIDENT_PHASES,
  INCIDENT_STATUSES,
} from "../lib/services/incident-status";

describe("incident status transitions (reusing investigation-state edges)", () => {
  it("walks the linear lifecycle", () => {
    expect(canTransitionIncidentStatus("OPEN", "INVESTIGATING")).toBe(true);
    expect(canTransitionIncidentStatus("INVESTIGATING", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionIncidentStatus("PENDING_APPROVAL", "RESOLVED")).toBe(true);
    expect(canTransitionIncidentStatus("RESOLVED", "CLOSED")).toBe(true);
  });

  it("allows closing straight from PENDING_APPROVAL (close without approving)", () => {
    expect(canTransitionIncidentStatus("PENDING_APPROVAL", "CLOSED")).toBe(true);
  });

  it("rejects backwards and skipped moves", () => {
    expect(canTransitionIncidentStatus("INVESTIGATING", "OPEN")).toBe(false);
    expect(canTransitionIncidentStatus("RESOLVED", "PENDING_APPROVAL")).toBe(false);
    expect(canTransitionIncidentStatus("OPEN", "RESOLVED")).toBe(false);
    expect(canTransitionIncidentStatus("OPEN", "PENDING_APPROVAL")).toBe(false);
    expect(canTransitionIncidentStatus("OPEN", "CLOSED")).toBe(false);
    expect(canTransitionIncidentStatus("INVESTIGATING", "RESOLVED")).toBe(false);
  });

  it("treats CLOSED as terminal", () => {
    for (const to of INCIDENT_STATUSES) {
      if (to === "CLOSED") continue; // self-transition is idempotent
      expect(canTransitionIncidentStatus("CLOSED", to)).toBe(false);
    }
  });

  it("is idempotent on same status", () => {
    for (const s of INCIDENT_STATUSES) {
      expect(canTransitionIncidentStatus(s, s)).toBe(true);
    }
  });

  it("the verify-pass edge must be VERIFY → RESOLVE (reused, not duplicated)", () => {
    // The only legal phase pair between PENDING_APPROVAL and RESOLVED.
    const edges = INCIDENT_PHASES.PENDING_APPROVAL.flatMap((f) =>
      INCIDENT_PHASES.RESOLVED.map((t) => `${f}->${t}`)
    );
    expect(edges).toContain("VERIFY->RESOLVE");
  });

  it("assert throws a validation error for invalid transitions", () => {
    expect(() => assertTransitionIncidentStatus("OPEN", "RESOLVED")).toThrow(/invalid incident transition/);
    expect(() => assertTransitionIncidentStatus("RESOLVED", "INVESTIGATING")).toThrow();
    // Legal moves do not throw
    expect(() => assertTransitionIncidentStatus("PENDING_APPROVAL", "RESOLVED")).not.toThrow();
  });
});