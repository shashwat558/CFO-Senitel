// Evidence service — record, list, and resolve lineage for IncidentEvidence.
// Routes validate transport concerns and delegate here. Resolution is
// org-scoped and best-effort: an unresolvable or missing source row yields
// `{ row: null, reason }`, never a fabricated record.

import type { PrismaClient } from "@prisma/client";
import { getIncident } from "../services/incidents";
import { NotFoundError, ValidationError } from "../services/errors";
import {
  isResolvableSourceType,
  listEvidenceQuerySchema,
  recordEvidenceSchema,
  type RecordEvidenceInput,
} from "./types";

export async function recordEvidence(db: PrismaClient, raw: unknown) {
  const parsed = recordEvidenceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(`invalid evidence: ${parsed.error.message}`);
  }
  const e: RecordEvidenceInput = parsed.data;
  return db.incidentEvidence.create({
    data: {
      incidentId: e.incidentId,
      findingId: e.findingId ?? null,
      toolName: e.toolName,
      input: (e.input ?? {}) as never,
      output: (e.output ?? {}) as never,
      summary: e.summary,
      sourceType: e.sourceType ?? null,
      sourceId: e.sourceId ?? null,
      relevance: e.relevance ?? null,
      confidence: e.confidence ?? null,
    },
  });
}

export interface ListEvidenceOpts {
  page?: unknown;
  pageSize?: unknown;
  findingId?: unknown;
  toolName?: unknown;
  sourceType?: unknown;
}

export async function listEvidence(
  db: PrismaClient,
  orgId: string,
  incidentId: string,
  opts: ListEvidenceOpts = {}
) {
  if (!orgId) throw new ValidationError("orgId is required");
  // Throws NotFoundError when the incident is outside this org's scope.
  await getIncident(db, orgId, incidentId);
  const parsed = listEvidenceQuerySchema.safeParse({
    findingId: opts.findingId,
    toolName: opts.toolName,
    sourceType: opts.sourceType,
  });
  if (!parsed.success) {
    throw new ValidationError(`invalid evidence filter: ${parsed.error.message}`);
  }
  const page = Number.isInteger(opts.page) && (opts.page as number) >= 1 ? (opts.page as number) : 1;
  const rawSize = Number.isInteger(opts.pageSize) ? (opts.pageSize as number) : 50;
  const pageSize = Math.min(200, Math.max(1, rawSize));
  const where = {
    incidentId,
    ...(parsed.data.findingId ? { findingId: parsed.data.findingId } : {}),
    ...(parsed.data.toolName ? { toolName: parsed.data.toolName } : {}),
    ...(parsed.data.sourceType ? { sourceType: parsed.data.sourceType } : {}),
  };
  const [total, items] = await Promise.all([
    db.incidentEvidence.count({ where }),
    db.incidentEvidence.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { items, total, page, pageSize };
}

export type ResolvedSource =
  | { kind: string; row: unknown }
  | { kind: string; row: null; reason: string };

/** Resolve an evidence row's source, org-scoped. Never throws for data gaps. */
export async function resolveEvidenceSource(
  db: PrismaClient,
  orgId: string,
  ev: { sourceType: string | null; sourceId: string | null }
): Promise<ResolvedSource | null> {
  if (!ev.sourceType || !ev.sourceId) return null;
  if (!isResolvableSourceType(ev.sourceType)) {
    return { kind: ev.sourceType, row: null, reason: `source kind ${ev.sourceType} has no model yet` };
  }
  let row: unknown = null;
  switch (ev.sourceType) {
    case "INVOICE":
      row = await db.invoice.findFirst({ where: { id: ev.sourceId, orgId } });
      break;
    case "CONTRACT":
      row = await db.contract.findFirst({ where: { id: ev.sourceId, orgId } });
      break;
    case "PURCHASE_ORDER":
      row = await db.purchaseOrder.findFirst({ where: { id: ev.sourceId, orgId } });
      break;
    case "TRANSACTION":
      row = await db.transaction.findFirst({ where: { id: ev.sourceId, orgId } });
      break;
    case "JOURNAL_ENTRY":
      row = await db.journalEntry.findFirst({ where: { id: ev.sourceId, orgId } });
      break;
    case "BANK_TRANSACTION":
      row = await db.bankTransaction.findFirst({ where: { id: ev.sourceId, orgId } });
      break;
    case "FORECAST":
      row = await db.forecast.findFirst({ where: { id: ev.sourceId, orgId } });
      break;
    case "BUDGET":
      row = await db.budget.findFirst({ where: { id: ev.sourceId, orgId } });
      break;
  }
  if (!row) return { kind: ev.sourceType, row: null, reason: "source row not found in this org" };
  return { kind: ev.sourceType, row };
}

export async function getEvidenceDetail(
  db: PrismaClient,
  orgId: string,
  incidentId: string,
  evidenceId: string,
  opts: { expandSource?: boolean } = {}
) {
  if (!orgId) throw new ValidationError("orgId is required");
  if (!evidenceId) throw new ValidationError("evidence id is required");
  await getIncident(db, orgId, incidentId);
  const item = await db.incidentEvidence.findFirst({
    where: { id: evidenceId, incidentId },
  });
  if (!item) throw new NotFoundError("evidence not found");
  const row = item as { sourceType: string | null; sourceId: string | null };
  const source = opts.expandSource ? await resolveEvidenceSource(db, orgId, row) : undefined;
  return { ...item, ...(opts.expandSource ? { source: source ?? null } : {}) };
}
