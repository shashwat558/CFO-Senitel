// Verification runner — re-queries authoritative evidence post-execution.
//
// Policy (Phase 3+): every EXECUTED action must be verified against FRESH
// tool output before the incident may be resolved. The runner:
//
//   1. reads the action's `verification` instruction from its payload (the
//      tool to re-query [getPnl | compareVendorPrices], the original input,
//      and the expected figures the action claims);
//   2. re-runs that tool against the current DB state (never computes numbers
//      itself — Agent → Tool → Financial Service → Prisma);
//   3. compares fresh output to the expected figures (numbers within the
//      0.01 rounding tolerance, everything else strictly);
//   4. marks the action VERIFIED on pass / FAILED on fail, persists a
//      VerificationResult (lib/verification/types.ts), records evidence +
//      audit, and on pass auto-advances the incident:
//        PENDING_APPROVAL → RESOLVED (phase edge VERIFY → RESOLVE, reused from
//        lib/agent/investigation-state.ts), or RESOLVED → CLOSED when a second
//        verified action confirms an already-resolved incident.

import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertTransitionInvestigation } from "../agent/investigation-state";
import type { VerificationResult } from "./types";
import { executeTool } from "../tools/registry";
import { ConflictError, NotFoundError } from "../services/errors";

/** Tools the verification runner may re-query. */
export const VERIFIABLE_TOOLS = ["getPnl", "compareVendorPrices"] as const;
export type VerifiableTool = (typeof VERIFIABLE_TOOLS)[number];

/** The action payload field describing the post-execution re-query. */
export const verificationInstructionSchema = z.object({
  toolName: z.enum(VERIFIABLE_TOOLS),
  // Original tool input (must include orgId; both tools org-match it).
  input: z.record(z.unknown()),
  // The figures the action claims — a subset of the tool output shape.
  expected: z.record(z.unknown()),
});
export type VerificationInstruction = z.infer<typeof verificationInstructionSchema>;

/** Money is rounded to 2dp by every deterministic service; a fresh figure
 *  "matches" when it is within one cent of the claimed figure. */
const EPSILON_CENTS = 1;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function valuesMatch(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    // Round the raw diff to cents so 29.99 vs 30.00 passes the one-cent
    // tolerance despite binary floating-point noise (30 - 29.99 = 0.0100…0156).
    return Math.round(Math.abs(a - b) * 100) <= EPSILON_CENTS;
  }
  return a === b;
}

/** Recursively check that every expected key is present in `fresh` with a
 *  matching value. Returns { ok, detail } — detail is the first mismatch. */
export function verifyAgainstFresh(
  expected: Record<string, unknown>,
  fresh: unknown,
  path = "output"
): { ok: boolean; detail: string } {
  if (!isRecord(fresh)) {
    return { ok: false, detail: `expected ${path} to be an object, got ${JSON.stringify(fresh)}` };
  }
  for (const [key, want] of Object.entries(expected)) {
    const got = fresh[key];
    if (got === undefined) {
      return { ok: false, detail: `expected key ${path}.${key} is missing from fresh output` };
    }
    if (isRecord(want)) {
      const nested = verifyAgainstFresh(want, got, `${path}.${key}`);
      if (!nested.ok) return nested;
    } else if (Array.isArray(want)) {
      if (!Array.isArray(got) || got.length !== want.length) {
        return {
          ok: false,
          detail: `expected key ${path}.${key} mismatch: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
        };
      }
      for (let i = 0; i < want.length; i += 1) {
        const wantEl = want[i];
        const gotEl = got[i];
        if (isRecord(wantEl)) {
          const el = verifyAgainstFresh(wantEl, gotEl, `${path}.${key}[${i}]`);
          if (!el.ok) return el;
        } else if (!valuesMatch(wantEl, gotEl)) {
          return {
            ok: false,
            detail: `expected key ${path}.${key}[${i}] mismatch: expected ${JSON.stringify(wantEl)}, got ${JSON.stringify(gotEl)}`,
          };
        }
      }
    } else if (!valuesMatch(want, got)) {
      return {
        ok: false,
        detail: `expected key ${path}.${key} mismatch: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
      };
    }
  }
  return { ok: true, detail: "" };
}

/**
 * Verify an EXECUTED action by re-querying the evidence its payload names.
 * Returns the persisted action + VerificationResult (+ incident row, which the
 * runner may auto-transition to RESOLVED/CLOSED on a pass).
 */
export async function verifyAction(
  db: PrismaClient,
  orgId: string,
  actionId: string,
  opts: { actorId?: string | null } = {}
) {
  const action = await db.incidentAction.findFirst({
    where: { id: actionId, incident: { orgId } },
    include: { incident: true },
  });
  if (!action) throw new NotFoundError("action not found");
  if (action.status !== "EXECUTED") {
    throw new ConflictError(`action must be EXECUTED before verification (current: ${action.status})`);
  }

  const incident = action.incident;
  const checkedAt = new Date().toISOString();

  // 1. Read the verification instruction from the payload.
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const parsed = verificationInstructionSchema.safeParse(payload.verification);
  const instruction = parsed.success ? parsed.data : null;
  const instructionError = parsed.success ? null : parsed.error.message;

  let verified = false;
  let detail = "";
  let fresh: unknown = null;

  if (!instruction) {
    detail = `no verification instruction in action payload: ${instructionError ?? "missing verification field"}`;
  } else {
    // 2. Re-query the named tool against fresh DB state.
    try {
      fresh = await executeTool(instruction.toolName, instruction.input, {
        db,
        orgId,
        audit: true,
      });
      // 3. Compare the fresh figures against the claimed ones.
      const check = verifyAgainstFresh(instruction.expected, fresh);
      verified = check.ok;
      detail = check.ok ? "fresh tool output matches the action's claimed figures" : check.detail;
    } catch (e) {
      detail = `re-query failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const result: VerificationResult = { actionId, verified, checkedAt, detail };

  // 4. Persist the result, mark the action, and record evidence + audit.
  const updated = await db.incidentAction.update({
    where: { id: action.id },
    data: {
      status: verified ? "VERIFIED" : "FAILED",
      verificationResult: result as never,
    },
  });

  try {
    await db.incidentEvidence.create({
      data: {
        incidentId: incident.id,
        findingId: (payload.findingId as string | undefined) ?? null,
        toolName: instruction?.toolName ?? "verification",
        input: { args: instruction?.input ?? {}, instructionError: instructionError ?? null } as never,
        output: { verification: result, fresh } as never,
        summary: `post-execution verification ${verified ? "passed" : "failed"}: ${detail}`,
      },
    });
  } catch {
    // Evidence must never break verification.
  }

  await db.auditLog.create({
    data: {
      orgId,
      actorId: opts.actorId ?? null,
      action: "action.verify",
      entityType: "IncidentAction",
      entityId: action.id,
      metadata: { incidentId: incident.id, status: verified ? "VERIFIED" : "FAILED", verified, detail, checkedAt } as never,
    },
  });

  // 5. Auto-transition the incident on a verified pass.
  let incidentUpdated: { status: string } | null = null;
  if (verified) {
    if (incident.status === "PENDING_APPROVAL") {
      // Reuse the investigation phase machine: VERIFY → RESOLVE is the legal
      // edge that resolves an incident.
      assertTransitionInvestigation("VERIFY", "RESOLVE");
      incidentUpdated = await db.financialIncident.update({
        where: { id: incident.id },
        data: { status: "RESOLVED", resolvedAt: new Date() } as never,
      });
    } else if (incident.status === "RESOLVED") {
      // A subsequent verified action confirms the resolution → close it.
      incidentUpdated = await db.financialIncident.update({
        where: { id: incident.id },
        data: { status: "CLOSED" } as never,
      });
    }
  }

  return { result, action: updated, incident: incidentUpdated ?? incident };
}