import type { PrismaClient } from "@prisma/client";
import type { z } from "zod";

export interface ToolContext {
  db: PrismaClient;
  /** Tenant scope — every tool call is org-isolated. */
  orgId: string;
  actorId?: string;
  /** Set false in bulk/tests to skip audit writes. */
  audit?: boolean;
}

export class ToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export interface ToolDefinition<TInput = never, TOutput = unknown> {
  name: string;
  description: string;
  // ZodTypeAny on purpose: tool schemas use defaults/refines whose
  // input/output types differ (e.g. limit defaults to 50). The registry
  // validates with safeParse, so strict generic variance adds no safety.
  inputSchema: z.ZodTypeAny;
  execute: (input: never, ctx: ToolContext) => Promise<TOutput>;
}

/** Best-effort audit log. Never fails the tool call itself. */
export async function auditToolCall(
  ctx: ToolContext,
  toolName: string,
  input: unknown,
  ok: boolean,
  extra?: Record<string, unknown>
): Promise<void> {
  if (ctx.audit === false) return;
  try {
    await ctx.db.auditLog.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.actorId ?? null,
        action: `tool.${toolName}`,
        entityType: "Tool",
        entityId: toolName,
        metadata: { input: sanitize(input), ok, ...(extra ?? {}) } as never,
      },
    });
  } catch {
    // Audit must never break evidence retrieval.
  }
}

function sanitize(input: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(input, (k, v) => (/key|secret|token|password/i.test(k) ? "[redacted]" : v))
    );
  } catch {
    return { unserializable: true };
  }
}

export function ensureOrgMatch(ctx: ToolContext, inputOrgId: string): void {
  if (!inputOrgId || inputOrgId !== ctx.orgId) {
    throw new ToolError("ORG_MISMATCH", "orgId does not match tool context");
  }
}
