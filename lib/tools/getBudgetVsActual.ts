import { z } from "zod";
import { budgetVsActual } from "../financial/cash";
import { monthSchema, orgIdSchema, yearSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, type ToolContext, type ToolDefinition } from "./types";

export const getBudgetVsActualInput = z.object({
  orgId: orgIdSchema,
  year: yearSchema,
  month: monthSchema,
});

export type GetBudgetVsActualInput = z.infer<typeof getBudgetVsActualInput>;

async function run(input: GetBudgetVsActualInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  const output = await budgetVsActual(ctx.db, input.orgId, input.year, input.month);
  await auditToolCall(ctx, "getBudgetVsActual", input, true);
  return output;
}

export const getBudgetVsActualTool: ToolDefinition<GetBudgetVsActualInput, Awaited<ReturnType<typeof run>>> = {
  name: "getBudgetVsActual",
  description:
    "Budget vs posted-GL actuals per account for one month, with variance and variance percent. Use to find which accounts blew through budget.",
  inputSchema: getBudgetVsActualInput,
  execute: run,
};
