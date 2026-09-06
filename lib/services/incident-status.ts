// Incident status state machine — the FinancialIncident lifecycle.
//
// Lifecycle: OPEN → INVESTIGATING → PENDING_APPROVAL → RESOLVED → CLOSED
// (PENDING_APPROVAL may also go straight to CLOSED; RESOLVED always closes).
//
// Instead of a second ad-hoc transition table, the incident statuses REUSE the
// investigator phase model (lib/agent/investigation-state.ts): each status
// maps to a phase range of the investigation, and a status change is legal
// exactly when a legal phase edge exists between the two ranges. The
// verification runner therefore transitions PENDING_APPROVAL → RESOLVED by
// advancing the phase VERIFY → RESOLVE, and the PATCH route validates every
// move through canTransitionIncidentStatus below.

import { canTransitionInvestigation, type InvestigationState } from "../agent/investigation-state";
import { ValidationError } from "./errors";

export const INCIDENT_STATUSES = [
  "OPEN",
  "INVESTIGATING",
  "PENDING_APPROVAL",
  "RESOLVED",
  "CLOSED",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** The investigation phase range an incident status implies. CLOSED is a
 *  terminal bookkeeping state with no phase of its own. */
export const INCIDENT_PHASES: Record<IncidentStatus, readonly InvestigationState[]> = {
  OPEN: ["DETECT"],
  INVESTIGATING: ["UNDERSTAND", "PLAN", "INVESTIGATE", "VALIDATE", "QUANTIFY"],
  PENDING_APPROVAL: ["RECOMMEND", "APPROVAL", "EXECUTE", "VERIFY"],
  RESOLVED: ["RESOLVE"],
  CLOSED: [],
};

export function isIncidentStatus(s: string): s is IncidentStatus {
  return (INCIDENT_STATUSES as readonly string[]).includes(s);
}

/**
 * True when an incident may move from `from` to `to`. Same-status is
 * idempotent. CLOSED is reachable from any status that can reach RESOLVED
 * (PENDING_APPROVAL → CLOSED closes without approving; RESOLVED → CLOSED is
 * the normal close). Everything else is decided by the investigation phase
 * edges — so OPEN→RESOLVED, INVESTIGATING→RESOLVED, and CLOSED→* are invalid.
 */
export function canTransitionIncidentStatus(from: IncidentStatus, to: IncidentStatus): boolean {
  if (from === to) return true;
  if (to === "CLOSED") return canTransitionIncidentStatus(from, "RESOLVED");
  const fromPhases = INCIDENT_PHASES[from];
  const toPhases = INCIDENT_PHASES[to];
  return fromPhases.some((f) => toPhases.some((t) => canTransitionInvestigation(f, t)));
}

export function assertTransitionIncidentStatus(from: IncidentStatus, to: IncidentStatus): void {
  if (!canTransitionIncidentStatus(from, to)) {
    throw new ValidationError(`invalid incident transition: ${from} -> ${to}`);
  }
}