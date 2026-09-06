import { z } from "zod";
import { fetchBankTransactions } from "../financial/cash";
import { orgIdSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const getBankTransactionsInput = z
  .object({
    orgId: orgIdSchema,
    bankAccountId: z.string().min(1).optional(),
    status: z.enum(["PENDING", "RECONCILED"]).optional(),
    source: z.enum(["MANUAL", "CSV_IMPORT", "DODO_IMPORT"]).optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .refine(
    (v) => (v.startDate !== undefined) === (v.endDate !== undefined),
    { message: "provide both startDate and endDate or neither" }
  )
  .refine(
    (v) => {
      if (v.startDate && v.endDate) return new Date(v.startDate).getTime() < new Date(v.endDate).getTime();
      return true;
    },
    { message: "startDate must be before endDate" }
  );

export type GetBankTransactionsInput = z.infer<typeof getBankTransactionsInput>;

async function run(input: GetBankTransactionsInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  let legs;
  try {
    legs = await fetchBankTransactions(ctx.db, input.orgId, {
      ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.startDate && input.endDate
        ? { start: new Date(input.startDate), end: new Date(input.endDate) }
        : {}),
    });
  } catch (e) {
    throw new ToolError("INVALID_RANGE", e instanceof Error ? e.message : "invalid range");
  }
  const output = legs.slice(0, input.limit).map((l) => ({
    id: l.id,
    bankAccountId: l.bankAccountId,
    date: l.date.toISOString(),
    description: l.description,
    amount: Number(l.amount),
    status: l.status,
    source: l.source,
    invoiceId: l.invoiceId,
  }));
  await auditToolCall(ctx, "getBankTransactions", input, true, { resultCount: output.length });
  return output;
}

export const getBankTransactionsTool: ToolDefinition<GetBankTransactionsInput, Awaited<ReturnType<typeof run>>> = {
  name: "getBankTransactions",
  description:
    "List bank legs (signed amounts: +collections, −payments/payroll/opex) with status PENDING/RECONCILED and source MANUAL/CSV_IMPORT/DODO_IMPORT. Filter source=DODO_IMPORT for connector-imported collections, then follow invoiceId for invoice lineage. Evidence for cash movements and unsettled items.",
  inputSchema: getBankTransactionsInput,
  execute: run,
};
