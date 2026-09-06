// Incident service — all incident read/write logic lives here.
// API routes validate transport concerns and delegate here.

import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { createIncidentSchema, type CreateIncidentInput } from "../validation/incident";
import { NotFoundError, ValidationError } from "./errors";

/** Optional per-call actor for audit attribution (session user). */
export interface ActorOptions {
  actorId?: string | null;
}
import {
  assertTransitionIncidentStatus,
  INCIDENT_STATUSES,
  type IncidentStatus,
} from "./incident-status";

/** Body schema for PATCH /api/incidents/[id] — status transitions and/or
 *  assignment. At least one field must be supplied; unknown statuses are
 *  rejected before any write. */
export const updateIncidentSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES).optional(),
    // Assign the incident to an org user (stub actor resolution like the
    // approval decider — no auth session exists yet).
    assignedToId: z.string().min(1).optional(),
  })
  .refine((v) => v.status !== undefined || v.assignedToId !== undefined, {
    message: "provide at least one of status or assignedToId",
  });

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

/**
 * Create an incident. The tenant comes from the session (orgId param), never
 * from the client body — createIncidentSchema no longer carries orgId, so a
 * client-supplied orgId is stripped before any write (no tenant spoofing).
 */
export async function createIncident(
  db: PrismaClient,
  orgId: string,
  raw: unknown,
  opts: ActorOptions = {}
) {
  const parsed = createIncidentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(`invalid incident: ${parsed.error.message}`);
  }
  const input: CreateIncidentInput = parsed.data;
  const incident = await db.financialIncident.create({
    data: {
      orgId,
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
      orgId,
      actorId: opts.actorId ?? null,
      action: "incident.create",
      entityType: "FinancialIncident", entityId: incident.id,
      metadata: { title: input.title, type: input.type } as never,
    },
  });
  return incident;
}

/**
 * Update an incident: transition its status along the lifecycle and/or assign
 * it to an org user.
 *
 *   - status: validated by the incident status machine (which reuses the
 *     investigation phase edges — VERIFY → RESOLVE is the PENDING_APPROVAL →
 *     RESOLVED path; an invalid move is a 400 ValidationError). Same-status is
 *     idempotent (200, no write).
 *   - assignedToId: the user must belong to the org (404 otherwise). No role
 *     gate — this is a bookkeeping assignment, not an approval decision.
 *   - resolvedAt is stamped when transitioning to RESOLVED.
 *
 * Writes one AuditLog per update ("incident.status", "incident.assign", or
 * "incident.update" when both change).
 */
export async function updateIncident(
  db: PrismaClient,
  orgId: string,
  id: string,
  raw: unknown,
  opts: ActorOptions = {}
) {
  if (!id) throw new ValidationError("incident id is required");
  const parsed = updateIncidentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(`invalid incident update: ${parsed.error.message}`);
  }
  const { status: nextStatus, assignedToId } = parsed.data;

  const incident = await db.financialIncident.findFirst({ where: { id, orgId } });
  if (!incident) throw new NotFoundError("incident not found");

  if (nextStatus !== undefined && nextStatus !== incident.status) {
    assertTransitionIncidentStatus(incident.status as IncidentStatus, nextStatus);
  }

  let assignee: { id: string } | null = null;
  if (assignedToId !== undefined) {
    assignee = await db.user.findFirst({
      where: { id: assignedToId, orgId },
      select: { id: true },
    });
    if (!assignee) throw new NotFoundError("assignee not found");
  }

  const data: Record<string, unknown> = {};
  if (nextStatus !== undefined && nextStatus !== incident.status) data.status = nextStatus;
  if (nextStatus === "RESOLVED" && nextStatus !== incident.status) data.resolvedAt = new Date();
  if (assignedToId !== undefined) data.assignedToId = assignedToId;

  const updated =
    Object.keys(data).length === 0
      ? incident
      : await db.financialIncident.update({ where: { id }, data: data as never });

  await db.auditLog.create({
    data: {
      orgId,
      actorId: opts.actorId ?? null,
      action:
        nextStatus !== undefined && assignedToId !== undefined
          ? "incident.update"
          : assignedToId !== undefined
            ? "incident.assign"
            : "incident.status",
      entityType: "FinancialIncident",
      entityId: id,
      metadata: {
        ...(nextStatus !== undefined ? { from: incident.status, to: nextStatus } : {}),
        ...(assignedToId !== undefined ? { assignedToId } : {}),
      } as never,
    },
  });

  return updated;
}
