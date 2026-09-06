import { z } from "zod";
import { getBankBalance } from "../financial/cash";
import { orgIdSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const getBankBalanceInput = z.object({
  orgId: orgIdSchema,
  bankAccountId: z.string().min(1).optional(),
  asOf: z.string().datetime({ offset: true }).optional(),
});

export type GetBankBalanceInput = z.infer<typeof getBankBalanceInput>;

async function run(input: GetBankBalanceInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  let asOf: Date | undefined;
  if (input.asOf) {
    asOf = new Date(input.asOf);
    if (Number.isNaN(asOf.getTime())) throw new ToolError("INVALID_RANGE", "invalid asOf date");
  }
  const output = await getBankBalance(ctx.db, input.orgId, {
    ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
    ...(asOf ? { asOf } : {}),
  });
  await auditToolCall(ctx, "getBankBalance", input, true);
  return output;
}

export const getBankBalanceTool: ToolDefinition<GetBankBalanceInput, Awaited<ReturnType<typeof run>>> = {
  name: "getBankBalance",
  description:
    "Cash position per bank account (opening + inflows − outflows) and total. Pass asOf for a point-in-time balance; legs after asOf are excluded.",
  inputSchema: getBankBalanceInput,
  execute: run,
};
