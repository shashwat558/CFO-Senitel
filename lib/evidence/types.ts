// Evidence lineage vocabulary (spec §§18–19).
//
// Every material agent conclusion traces CLAIM → FINDING → CALCULATION →
// source row → origin system. sourceType names the KIND of source row,
// sourceId is that row's id. Kinds without a model yet (bank/forecast/budget/
// document) are valid enum values but resolve to null until B4 lands —
// resolution never fabricates a row.

import { z } from "zod";

export const EVIDENCE_SOURCE_TYPES = [
  "TRANSACTION",
  "JOURNAL_ENTRY",
  "INVOICE",
  "PURCHASE_ORDER",
  "CONTRACT",
  "BANK_TRANSACTION",
  "FORECAST",
  "BUDGET",
  "CALCULATION",
  "AGENT_OBSERVATION",
  "DOCUMENT",
] as const;

export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export const evidenceSourceTypeSchema = z.enum(EVIDENCE_SOURCE_TYPES);

// Source kinds backed by a Prisma model today (org-scoped resolution).
export const RESOLVABLE_SOURCE_TYPES = [
  "TRANSACTION",
  "JOURNAL_ENTRY",
  "INVOICE",
  "PURCHASE_ORDER",
  "CONTRACT",
] as const satisfies ReadonlyArray<EvidenceSourceType>;

export function isResolvableSourceType(t: string): boolean {
  return (RESOLVABLE_SOURCE_TYPES as readonly string[]).includes(t);
}

const weight = (name: string) =>
  z.number().min(0, `${name} must be 0..1`).max(1, `${name} must be 0..1`).optional();

export const recordEvidenceSchema = z
  .object({
    incidentId: z.string().min(1),
    toolName: z.string().min(1),
    input: z.unknown().default({}),
    output: z.unknown().default({}),
    summary: z.string().min(1, "summary is required").max(2000),
    findingId: z.string().min(1).optional(),
    sourceType: evidenceSourceTypeSchema.optional(),
    sourceId: z.string().min(1).optional(),
    relevance: weight("relevance"),
    confidence: weight("confidence"),
  })
  .refine((v) => (v.sourceType !== undefined) === (v.sourceId !== undefined), {
    message: "provide both sourceType and sourceId or neither",
  });

export type RecordEvidenceInput = z.infer<typeof recordEvidenceSchema>;

export const listEvidenceQuerySchema = z.object({
  findingId: z.string().min(1).optional(),
  toolName: z.string().min(1).optional(),
  sourceType: evidenceSourceTypeSchema.optional(),
});

export type ListEvidenceQuery = z.infer<typeof listEvidenceQuerySchema>;
