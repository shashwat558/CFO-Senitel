// Incident service — all incident read/write logic lives here.
// API routes validate transport concerns and delegate here.

import type { PrismaClient } from "@prisma/client";
import { createIncidentSchema, type CreateIncidentInput } from "../validation/incident";

export async function listIncidents(
  db: PrismaClient,
  orgId: string,
  opts: { page?: number; pageSize?: number; status?: string } = {}
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
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
  const incident = await db.financialIncident.findFirst({
    where: { id, orgId },
    include: {
      findings: { orderBy: { rank: "asc" } },
      evidence: { orderBy: { occurredAt: "desc" }, take: 100 },
      actions: { orderBy: { createdAt: "asc" } },
      approvals: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!incident) throw new Error("incident not found");
  return incident;
}

export async function createIncident(db: PrismaClient, raw: unknown) {
  const parsed = createIncidentSchema.safeParse(raw);
  if (!parsed.success) {
    const err = new Error(`invalid incident: ${parsed.error.message}`);
    (err as { status?: number }).status = 400;
    throw err;
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
