// Evidence helper — every material agent conclusion must trace to rows here.
// Phase 1: used by seed/tests; Phase 2: the Investigator Agent records each
// tool call's input/output as IncidentEvidence via this function.

import type { PrismaClient } from "@prisma/client";

export interface RecordEvidenceInput {
  incidentId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  summary: string;
  findingId?: string;
}

export async function recordEvidence(db: PrismaClient, e: RecordEvidenceInput) {
  if (!e.incidentId) throw new Error("incidentId is required");
  if (!e.toolName) throw new Error("toolName is required");
  return db.incidentEvidence.create({
    data: {
      incidentId: e.incidentId,
      findingId: e.findingId ?? null,
      toolName: e.toolName,
      input: (e.input ?? {}) as never,
      output: (e.output ?? {}) as never,
      summary: e.summary.slice(0, 2000),
    },
  });
}
