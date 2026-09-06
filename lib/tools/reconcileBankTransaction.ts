import { z } from "zod";
import { round2 } from "../financial/calculations";
import { orgIdSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const reconcileBankTransactionInput = z.object({
  orgId: orgIdSchema,
  bankTransactionId: z.string().min(1),
  // Omit for internal legs (transfers, fees) — they reconcile by note alone.
  invoiceId: z.string().min(1).optional(),
  note: z.string().max(500).optional(),
});

export type ReconcileBankTransactionInput = z.infer<typeof reconcileBankTransactionInput>;

async function run(input: ReconcileBankTransactionInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  const leg = await ctx.db.bankTransaction.findFirst({
    where: { id: input.bankTransactionId, orgId: input.orgId },
  });
  if (!leg) throw new ToolError("NOT_FOUND", "bank transaction not found");
  if (leg.status === "RECONCILED") {
    throw new ToolError("ALREADY_RECONCILED", "bank transaction is already reconciled");
  }

  let invoiceId: string | null = null;
  if (input.invoiceId) {
    const inv = await ctx.db.invoice.findFirst({
      where: { id: input.invoiceId, orgId: input.orgId },
    });
    if (!inv) throw new ToolError("NOT_FOUND", "invoice not found");
    // Exact cents match — reconciliation must never paper over a difference.
    if (round2(Math.abs(Number(leg.amount))) !== round2(Number(inv.total))) {
      throw new ToolError(
        "AMOUNT_MISMATCH",
        `bank amount ${Number(leg.amount)} does not match invoice total ${Number(inv.total)}`
      );
    }
    // Direction: AP invoices settle as outflows, AR as inflows.
    if (inv.type === "AP" && Number(leg.amount) >= 0) {
      throw new ToolError("DIRECTION_MISMATCH", "AP invoice requires a negative (outflow) bank leg");
    }
    if (inv.type === "AR" && Number(leg.amount) <= 0) {
      throw new ToolError("DIRECTION_MISMATCH", "AR invoice requires a positive (inflow) bank leg");
    }
    invoiceId = inv.id;
  }

  // Deep-link the invoice's principal GL line when the leg names an invoice.
  let glTransactionId: string | null = null;
  if (invoiceId) {
    const principal = await ctx.db.transaction.findFirst({
      where: { orgId: input.orgId, invoiceId, debit: { gt: 0 } },
      orderBy: { id: "asc" },
    });
    glTransactionId = principal?.id ?? null;
  }

  const updated = await ctx.db.bankTransaction.update({
    where: { id: leg.id },
    data: { status: "RECONCILED", ...(invoiceId ? { invoiceId, glTransactionId } : {}) },
  });
  await ctx.db.auditLog.create({
    data: {
      orgId: input.orgId,
      actorId: ctx.actorId ?? null,
      action: "bank.reconcile",
      entityType: "BankTransaction",
      entityId: leg.id,
      metadata: { invoiceId, note: input.note ?? null } as never,
    },
  });
  const output = {
    bankTransactionId: updated.id,
    status: updated.status,
    invoiceId,
    glTransactionId,
    amount: Number(updated.amount),
  };
  await auditToolCall(ctx, "reconcileBankTransaction", input, true);
  return output;
}

export const reconcileBankTransactionTool: ToolDefinition<
  ReconcileBankTransactionInput,
  Awaited<ReturnType<typeof run>>
> = {
  name: "reconcileBankTransaction",
  description:
    "Mark a PENDING bank leg RECONCILED against an invoice (exact cents + direction checked) or by note for internal legs. Already-reconciled legs are rejected.",
  inputSchema: reconcileBankTransactionInput,
  execute: run,
};
