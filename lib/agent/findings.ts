// Finding creation — persist structured findings from agent investigations.
//
// A finding is the durable, shareable form of an investigative conclusion
// (often mirroring a hypothesis). It carries:
//   statement, type, status, impact, confidence, incident + agent step link.
//
// Statuses: HYPOTHESIS -> INVESTIGATING -> SUPPORTED -> VALIDATED,
//           with REJECTED and UNKNOWN branches.
//
// Persistence reuses the existing Prisma `IncidentFinding` model (no schema
// change): title=statement, confidence=confidence, rank=order, and
// description holds a JSON envelope {kind,type,status,impact,agentStepId,
// summary}. Readers fall back to UNKNOWN/empty values for legacy rows whose
// description is plain text.

import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

export const findingTypeSchema = z.enum([
  "HYPOTHESIS",
  "ROOT_CAUSE",
  "CONTRIBUTING_FACTOR",
  "IMPACT",
  "OBSERVATION",
]);
export type FindingType = z.infer<typeof findingTypeSchema>;

export const findingStatusSchema = z.enum([
  "HYPOTHESIS",
  "INVESTIGATING",
  "SUPPORTED",
  "VALIDATED",
  "REJECTED",
  "UNKNOWN",
]);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

const TRANSITIONS: Record<FindingStatus, ReadonlyArray<FindingStatus>> = {
  HYPOTHESIS: ["INVESTIGATING", "REJECTED", "UNKNOWN"],
  INVESTIGATING: ["SUPPORTED", "REJECTED", "UNKNOWN"],
  SUPPORTED: ["VALIDATED", "REJECTED", "UNKNOWN"],
  VALIDATED: ["REJECTED", "UNKNOWN"],
  REJECTED: ["INVESTIGATING", "UNKNOWN"],
  UNKNOWN: ["HYPOTHESIS", "INVESTIGATING", "UNKNOWN"],
};

export function canTransitionFinding(from: FindingStatus, to: FindingStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertFindingTransition(from: FindingStatus, to: FindingStatus): void {
  if (!canTransitionFinding(from, to)) {
    throw new Error(`Invalid finding transition: ${from} -> ${to}`);
  }
}

export const findingImpactSchema = z.object({
  monetaryAmount: z.number().nullable().default(null),
  currency: z.string().default("USD"),
  description: z.string().default(""),
});
export type FindingImpact = z.infer<typeof findingImpactSchema>;

export const findingSchema = z.object({
  id: z.string().min(1),
  incidentId: z.string().min(1),
  statement: z.string().min(3).max(2000),
  type: findingTypeSchema.default("OBSERVATION"),
  status: findingStatusSchema.default("HYPOTHESIS"),
  impact: findingImpactSchema.default({}),
  confidence: z.number().min(0).max(1).default(0.5),
  agentStepId: z.string().nullable().default(null),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type Finding = z.infer<typeof findingSchema>;

let counter = 0;

export function createFinding(input: {
  incidentId: string;
  statement: string;
  id?: string;
  type?: FindingType;
  status?: FindingStatus;
  impact?: Partial<FindingImpact>;
  confidence?: number;
  agentStepId?: string | null;
}): Finding {
  counter += 1;
  return findingSchema.parse({
    id: input.id ?? `f_${Date.now().toString(36)}_${counter}`,
    incidentId: input.incidentId,
    statement: input.statement,
    type: input.type ?? "OBSERVATION",
    status: input.status ?? "HYPOTHESIS",
    impact: { monetaryAmount: null, currency: "USD", description: "", ...(input.impact ?? {}) },
    confidence: input.confidence ?? 0.5,
    agentStepId: input.agentStepId ?? null,
  });
}

function touch(f: Finding): Finding {
  return findingSchema.parse({ ...f, updatedAt: new Date().toISOString() });
}

export function setFindingStatus(f: Finding, status: FindingStatus): Finding {
  assertFindingTransition(f.status, status);
  return touch({ ...f, status });
}

export function setFindingImpact(f: Finding, impact: Partial<FindingImpact>): Finding {
  return touch({
    ...f,
    impact: findingImpactSchema.parse({ ...f.impact, ...impact }),
  });
}

export function setFindingConfidence(f: Finding, confidence: number): Finding {
  return touch({ ...f, confidence: findingSchema.shape.confidence.parse(confidence) });
}

export function linkAgentStep(f: Finding, agentStepId: string): Finding {
  return touch({ ...f, agentStepId });
}

// ---------------------------------------------------------------------------
// Persistence (existing IncidentFinding model).
// ---------------------------------------------------------------------------

interface FindingEnvelope {
  kind: "finding";
  type: FindingType;
  status: FindingStatus;
  impact: FindingImpact;
  agentStepId: string | null;
  summary: string;
}

/** Serialize a finding into an IncidentFinding row payload. */
export function toIncidentFindingRow(f: Finding, rank: number): {
  incidentId: string;
  title: string;
  description: string;
  confidence: number;
  rank: number;
} {
  const envelope: FindingEnvelope = {
    kind: "finding",
    type: f.type,
    status: f.status,
    impact: f.impact,
    agentStepId: f.agentStepId,
    summary: f.statement,
  };
  return {
    incidentId: f.incidentId,
    title: f.statement.slice(0, 500),
    description: JSON.stringify(envelope).slice(0, 8000),
    confidence: f.confidence,
    rank,
  };
}

/** Deserialize an IncidentFinding row back into a Finding (tolerant of legacy rows). */
export function fromIncidentFindingRow(row: {
  id: string;
  incidentId: string;
  title: string;
  description: string;
  confidence: number | string | { toString(): string };
  rank?: number;
}): Finding {
  const confidence = Number(row.confidence?.toString() ?? 0.5);
  const fallback: Finding = {
    id: row.id,
    incidentId: row.incidentId,
    statement: row.title,
    type: "OBSERVATION",
    status: "UNKNOWN",
    impact: { monetaryAmount: null, currency: "USD", description: "" },
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    agentStepId: null,
    updatedAt: new Date().toISOString(),
  };
  try {
    const env = JSON.parse(row.description) as Partial<FindingEnvelope>;
    if (env?.kind !== "finding") return fallback;
    return findingSchema.parse({
      id: row.id,
      incidentId: row.incidentId,
      statement: row.title,
      type: env.type ?? fallback.type,
      status: env.status ?? fallback.status,
      impact: env.impact ?? fallback.impact,
      confidence: fallback.confidence,
      agentStepId: env.agentStepId ?? null,
    });
  } catch {
    return fallback;
  }
}

/** Create the IncidentFinding row for a finding; returns the row id. */
export async function recordFinding(
  db: PrismaClient,
  f: Finding,
  rank = 0,
): Promise<string> {
  const row = await db.incidentFinding.create({ data: toIncidentFindingRow(f, rank) });
  return (row as { id: string }).id;
}

/** Update the existing IncidentFinding row for a finding. */
export async function updateFindingRow(
  db: PrismaClient,
  rowId: string,
  f: Finding,
  rank = 0,
): Promise<void> {
  await db.incidentFinding.update({ where: { id: rowId }, data: toIncidentFindingRow(f, rank) });
}
