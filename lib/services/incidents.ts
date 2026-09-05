// Incident service — all incident read/write logic lives here.
// API routes validate transport concerns and delegate here.

import type { PrismaClient } from "@prisma/client";
import { createIncidentSchema, type CreateIncidentInput } from "../validation/incident";
import { NotFoundError, ValidationError } from "./errors";

const INCIDENT_STATUSES = ["OPEN", "INVESTIGATING", "PENDING_APPROVAL", "RESOLVED", "CLOSED"] as const;

function sanitizePage(n: unknown, fallback: number): number {
  const v = typeof n === "string" ? Number(n) : (n as number);
  if (!Number.isFinite(v) || !Number.isInteger(Math.floor(v))) return fallback;
  return v as number;
}

export async function listIncidents(
  db: PrismaClient,
  orgId: string,
  opts: { page?: number; pageSize?: number; status?: string } = {}
) {
  const page = Math.min(1000, Math.max(1, sanitizePage(opts.page, 1) || 1));
  const rawSize = sanitizePage(opts.pageSize, 20) || 20;
  const pageSize = Math.min(100, Math.max(1, rawSize));
  if (opts.status !== undefined && !(INCIDENT_STATUSES as readonly string[]).includes(opts.status)) {
    throw new ValidationError(`invalid status: ${opts.status}`);
  }
  const where = {
    orgId,
    ...(opts.status ? { status: opts.status as never } : {}),
  };
  const [total, items] = await Promise.all([
    db.financialIncident.count({ where }),
    db.financialIncident.findMany({
      where,
      orderBy: [{ detectedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { findings: true, evidence: true, actions: true } },
      },
    }),
  ]);
  return { items, total, page, pageSize };
}

export async function getIncident(db: PrismaClient, orgId: string, id: string) {
  if (!id) throw new ValidationError("incident id is required");
  const incident = await db.financialIncident.findFirst({
    where: { id, orgId },
    include: {
      findings: { orderBy: { rank: "asc" } },
      evidence: { orderBy: { occurredAt: "desc" }, take: 100 },
      actions: { orderBy: { createdAt: "asc" } },
      approvals: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!incident) throw new NotFoundError("incident not found");
  return incident;
}

export async function createIncident(db: PrismaClient, raw: unknown) {
  const parsed = createIncidentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(`invalid incident: ${parsed.error.message}`);
  }
  const input: CreateIncidentInput = parsed.data;
  const incident = await db.financialIncident.create({
    data: {
      orgId: input.orgId,
      title: input.title,
      description: input.description,
      type: input.type as never,
      severity: input.severity as never,
      periodStart: input.periodStart ? new Date(input.periodStart) : null,
      periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
    },
  });
  await db.auditLog.create({
    data: {
      orgId: input.orgId, action: "incident.create",
      entityType: "FinancialIncident", entityId: incident.id,
      metadata: { title: input.title, type: input.type } as never,
    },
  });
  return incident;
}
