// Approval service — decides a PENDING approval and drives the linked action
// through the propose → approve/reject state machine (PROPOSED → APPROVED /
// REJECTED), writing an AuditLog on every decision.
//
// Role gate: only CFO/CONTROLLER may decide (403 otherwise); VIEWER is
// read-only. The decider comes from the session (decidedById = session user);
// AuditLog.actorId is the decider's id.

import type { PrismaClient } from "@prisma/client";
import { approvalDecisionSchema } from "../approvals/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";

/** Roles allowed to decide approvals (and, via actions.ts, to execute them). */
export const APPROVER_ROLES = ["CFO", "CONTROLLER"] as const;

export function canDecideApproval(role: string): boolean {
  return (APPROVER_ROLES as readonly string[]).includes(role);
}

/** Resolve + validate the decider (the session user via org-scoped lookup):
 *  must exist in the org (404) and be CFO/CONTROLLER (403). */
export async function resolveDecider(
  db: PrismaClient,
  orgId: string,
  decidedById?: string
) {
  if (!decidedById) return null;
  const user = await db.user.findFirst({ where: { id: decidedById, orgId } });
  if (!user) throw new NotFoundError("decider not found");
  if (!canDecideApproval(user.role)) {
    throw new ForbiddenError("user role cannot decide approvals");
  }
  return user;
}

/**
 * Decide a PENDING approval (`decision` ∈ APPROVED | REJECTED) and transition
 * the linked action PROPOSED → APPROVED | REJECTED. Idempotency rule: a
 * decided approval or a non-PROPOSED action is a 409 conflict, never a
 * silent overwrite.
 */
export async function decideApproval(db: PrismaClient, orgId: string, raw: unknown) {
  const parsed = approvalDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(`invalid approval decision: ${parsed.error.message}`);
  }
  const { approvalId, decision, decidedById, reason } = parsed.data;

  const approval = await db.approval.findFirst({
    where: { id: approvalId, orgId },
  });
  if (!approval) throw new NotFoundError("approval not found");
  if (approval.status !== "PENDING") {
    throw new ConflictError(`approval is already ${approval.status.toLowerCase()}`);
  }

  const decider = await resolveDecider(db, orgId, decidedById);

  const { approval: updated, action } = await db.$transaction(async (tx) => {
    const updated = await tx.approval.update({
      where: { id: approval.id },
      data: {
        status: decision,
        decidedById: decider?.id ?? null,
        decidedAt: new Date(),
        reason,
      },
    });

    let action: { id: string; status: string } | null = null;
    if (updated.actionId) {
      const existing = await tx.incidentAction.findUnique({
        where: { id: updated.actionId },
        select: { id: true, status: true },
      });
      if (!existing) throw new NotFoundError("linked action not found");
      if (existing.status !== "PROPOSED") {
        throw new ConflictError(`action is already ${existing.status.toLowerCase()}`);
      }
      action = await tx.incidentAction.update({
        where: { id: existing.id },
        data: { status: decision === "APPROVED" ? "APPROVED" : "REJECTED" },
      });
    }
    return { approval: updated, action };
  });

  await db.auditLog.create({
    data: {
      orgId,
      actorId: decider?.id ?? null,
      action: decision === "APPROVED" ? "approval.approve" : "approval.reject",
      entityType: "Approval",
      entityId: approval.id,
      metadata: {
        actionId: action?.id ?? null,
        actionStatus: action?.status ?? null,
        reason,
      } as never,
    },
  });

  return { approval: updated, action };
}