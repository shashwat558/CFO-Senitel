// Action service — the IncidentAction state machine lives here:
//
//   proposeAction  → IncidentAction PROPOSED + Approval PENDING (Phase 3)
//   executeAction  → execution worker stub: APPROVED → EXECUTED | FAILED,
//                    writes `simulationResult` Json (deterministic, no side
//                    effects — the LLM never computes financial numbers).
//
// API routes are thin wrappers that resolve the org and delegate here.

import type { PrismaClient } from "@prisma/client";
import { proposedActionSchema } from "../actions/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { APPROVER_ROLES } from "./approvals";

/** Roles allowed to execute an approved action (same gate as approval
 *  decisions — CFO/CONTROLLER; VIEWER is read-only). */
export function canExecuteAction(role: string): boolean {
  return (APPROVER_ROLES as readonly string[]).includes(role);
}

/** Session actor for audit attribution (id) + role gate (role). */
export interface ActionActor {
  id: string;
  role: string;
}

/**
 * Propose an IncidentAction (status PROPOSED) for a finding, and open a
 * PENDING Approval for it so the approve/reject endpoints can decide it.
 *
 * Org-scoped: the incident must belong to the org and the finding must
 * belong to the incident. The action payload records the originating
 * findingId so intent stays traceable end-to-end.
 */
export async function proposeAction(
  db: PrismaClient,
  orgId: string,
  raw: unknown,
  opts: { actorId?: string | null } = {}
) {
  const parsed = proposedActionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(`invalid action: ${parsed.error.message}`);
  }
  const { incidentId, findingId, type, title, description, payload } = parsed.data;

  const incident = await db.financialIncident.findFirst({
    where: { id: incidentId, orgId },
    select: { id: true },
  });
  if (!incident) throw new NotFoundError("incident not found");

  const finding = await db.incidentFinding.findFirst({
    where: { id: findingId, incidentId },
    select: { id: true },
  });
  if (!finding) throw new NotFoundError("finding not found");

  // The session user requests the approval (and is the audit actor). The
  // first-org-user fallback keeps direct service callers working without a
  // session; AuditLog.actorId is filled whenever an actor is supplied.
  const requester = opts.actorId
    ? await db.user.findFirst({
        where: { id: opts.actorId, orgId },
        select: { id: true },
      })
    : await db.user.findFirst({
        where: { orgId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
  if (!requester) throw new NotFoundError("no org user available to request the approval");

  const { action, approval } = await db.$transaction(async (tx) => {
    const action = await tx.incidentAction.create({
      data: {
        incidentId,
        type,
        title,
        description,
        status: "PROPOSED",
        payload: { ...payload, findingId } as never,
      },
    });
    const approval = await tx.approval.create({
      data: {
        orgId,
        incidentId,
        actionId: action.id,
        requestedById: requester.id,
        status: "PENDING",
      },
    });
    return { action, approval };
  });

  await db.auditLog.create({
    data: {
      orgId,
      actorId: opts.actorId ?? null,
      action: "action.propose",
      entityType: "IncidentAction",
      entityId: action.id,
      metadata: {
        incidentId,
        findingId,
        title,
        status: "PROPOSED",
        approvalId: approval.id,
      } as never,
    },
  });

  return { action, approval };
}

/**
 * Execution worker stub — takes an APPROVED action through deterministic
 * "simulated execution": marks it EXECUTED with a `simulationResult` Json
 * (or FAILED with the error). No side effects are applied; a real
 * simulation engine slots into the stub body.
 *
 * Role gate: only CFO/CONTROLLER may execute (403 otherwise). The actor —
 * when supplied — is recorded as the AuditLog.actorId.
 */
export async function executeAction(
  db: PrismaClient,
  orgId: string,
  actionId: string,
  opts: { actor?: ActionActor } = {}
) {
  if (opts.actor && !canExecuteAction(opts.actor.role)) {
    throw new ForbiddenError("user role cannot execute actions");
  }
  const action = await db.incidentAction.findFirst({
    where: { id: actionId, incident: { orgId } },
  });
  if (!action) throw new NotFoundError("action not found");
  if (action.status !== "APPROVED") {
    throw new ConflictError(`action must be APPROVED before execution (current: ${action.status})`);
  }

  const simulatedAt = new Date().toISOString();
  let status: "EXECUTED" | "FAILED";
  let simulationResult: Record<string, unknown>;
  try {
    // Stub simulation — deterministic, computes nothing financial.
    status = "EXECUTED";
    simulationResult = {
      ok: true,
      engine: "stub",
      simulatedAt,
      actionId: action.id,
      status,
      summary: "Execution worker stub — no side effects applied.",
    };
  } catch (e) {
    status = "FAILED";
    simulationResult = {
      ok: false,
      simulatedAt,
      error: e instanceof Error ? e.message : "simulation failed",
    };
  }

  const updated = await db.incidentAction.update({
    where: { id: action.id },
    data: { status, simulationResult: simulationResult as never },
  });

  await db.auditLog.create({
    data: {
      orgId,
      actorId: opts.actor?.id ?? null,
      action: "action.execute",
      entityType: "IncidentAction",
      entityId: action.id,
      metadata: { status, simulatedAt } as never,
    },
  });

  return updated;
}