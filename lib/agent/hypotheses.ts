// Hypothesis management — the agent forms, tests, and abandons hypotheses.
//
// Lifecycle: PROPOSED -> INVESTIGATING -> SUPPORTED | REJECTED.
// A SUPPORTED hypothesis can be overturned (-> REJECTED) by new contradictory
// evidence; a REJECTED one can be reopened (-> INVESTIGATING). Terminal states
// are intentionally absent: science never fully closes the books, and the
// acceptance case is abandoning an unsupported hypothesis for another one.
//
// Persistence reuses existing Prisma models:
//   - IncidentFinding rows carry the hypothesis (title=statement,
//     description=status + confidence, confidence column, rank=order).
//   - IncidentEvidence rows link via findingId as supporting/contradictory
//     evidence for a hypothesis.

import { z } from "zod";
import { createFinding, toIncidentFindingRow } from "./findings";

export const hypothesisStatusSchema = z.enum([
  "PROPOSED",
  "INVESTIGATING",
  "SUPPORTED",
  "REJECTED",
]);
export type HypothesisStatus = z.infer<typeof hypothesisStatusSchema>;

const TRANSITIONS: Record<HypothesisStatus, ReadonlyArray<HypothesisStatus>> = {
  PROPOSED: ["INVESTIGATING", "REJECTED"],
  INVESTIGATING: ["SUPPORTED", "REJECTED"],
  SUPPORTED: ["REJECTED"],
  REJECTED: ["INVESTIGATING"],
};

export function canTransitionHypothesis(from: HypothesisStatus, to: HypothesisStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertHypothesisTransition(from: HypothesisStatus, to: HypothesisStatus): void {
  if (!canTransitionHypothesis(from, to)) {
    throw new Error(`Invalid hypothesis transition: ${from} -> ${to}`);
  }
}

export const hypothesisSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(3).max(2000),
  status: hypothesisStatusSchema.default("PROPOSED"),
  confidence: z.number().min(0).max(1).default(0.5),
  supportingEvidence: z.array(z.string()).default([]),
  contradictoryEvidence: z.array(z.string()).default([]),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type Hypothesis = z.infer<typeof hypothesisSchema>;

let counter = 0;

export function createHypothesis(input: {
  statement: string;
  id?: string;
  confidence?: number;
}): Hypothesis {
  counter += 1;
  return hypothesisSchema.parse({
    id: input.id ?? `h_${Date.now().toString(36)}_${counter}`,
    statement: input.statement,
    status: "PROPOSED",
    confidence: input.confidence ?? 0.5,
  });
}

function touch(h: Hypothesis): Hypothesis {
  return hypothesisSchema.parse({ ...h, updatedAt: new Date().toISOString() });
}

export function setHypothesisStatus(h: Hypothesis, status: HypothesisStatus): Hypothesis {
  assertHypothesisTransition(h.status, status);
  return touch({ ...h, status });
}

export function setConfidence(h: Hypothesis, confidence: number): Hypothesis {
  return touch({ ...h, confidence: hypothesisSchema.shape.confidence.parse(confidence) });
}

/** Record a supporting observation; nudges confidence up unless stated. */
export function addSupportingEvidence(
  h: Hypothesis,
  note: string,
  confidence?: number,
): Hypothesis {
  const next = {
    ...h,
    supportingEvidence: [...h.supportingEvidence, note],
    confidence: confidence ?? Math.min(1, h.confidence + 0.1),
  };
  return touch(hypothesisSchema.parse(next));
}

/** Record a contradicting observation; nudges confidence down unless stated. */
export function addContradictoryEvidence(
  h: Hypothesis,
  note: string,
  confidence?: number,
): Hypothesis {
  const next = {
    ...h,
    contradictoryEvidence: [...h.contradictoryEvidence, note],
    confidence: confidence ?? Math.max(0, h.confidence - 0.2),
  };
  return touch(hypothesisSchema.parse(next));
}

/** The currently pursued explanation: newest INVESTIGATING, else newest PROPOSED. */
export function activeHypothesis(hypotheses: Hypothesis[]): Hypothesis | null {
  const inv = hypotheses.filter((h) => h.status === "INVESTIGATING");
  if (inv.length > 0) return inv[inv.length - 1];
  const prop = hypotheses.filter((h) => h.status === "PROPOSED");
  if (prop.length > 0) return prop[prop.length - 1];
  return null;
}

/** Serialize a hypothesis into an IncidentFinding row payload (via Finding). */
export function toIncidentFinding(h: Hypothesis, incidentId: string, rank: number): {
  incidentId: string;
  title: string;
  description: string;
  confidence: number;
  rank: number;
} {
  const statusMap = {
    PROPOSED: "HYPOTHESIS",
    INVESTIGATING: "INVESTIGATING",
    SUPPORTED: "SUPPORTED",
    REJECTED: "REJECTED",
  } as const;
  const finding = createFinding({
    incidentId,
    statement: h.statement,
    id: h.id,
    type: "HYPOTHESIS",
    status: statusMap[h.status],
    confidence: h.confidence,
  });
  return toIncidentFindingRow(finding, rank);
}
