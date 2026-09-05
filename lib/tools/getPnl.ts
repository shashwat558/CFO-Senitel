import { z } from "zod";
import { fetchMonthlyPnl, fetchPnl } from "../financial/pnl";
import { monthSchema, orgIdSchema, yearSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const getPnlInput = z
  .object({
    orgId: orgIdSchema,
    year: yearSchema.optional(),
    month: monthSchema.optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (v) =>
      (v.year !== undefined && v.month !== undefined) ||
      (v.startDate !== undefined && v.endDate !== undefined),
    { message: "provide either (year + month) or (startDate + endDate)" }
  )
  .refine(
    (v) => {
      if (v.startDate !== undefined && v.endDate !== undefined) {
        return new Date(v.startDate).getTime() < new Date(v.endDate).getTime();
      }
      return true;
    },
    { message: "startDate must be before endDate" }
  );

export type GetPnlInput = z.infer<typeof getPnlInput>;

async function run(input: GetPnlInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  let summary;
  try {
    summary =
      input.year !== undefined && input.month !== undefined
        ? await fetchMonthlyPnl(ctx.db, input.orgId, input.year, input.month)
        : await fetchPnl(ctx.db, input.orgId, new Date(input.startDate!), new Date(input.endDate!));
  } catch (e) {
    throw new ToolError("INVALID_RANGE", e instanceof Error ? e.message : "invalid date range");
  }
  const output = {
    ...summary,
    start: summary.start.toISOString(),
    end: summary.end.toISOString(),
  };
  await auditToolCall(ctx, "getPnl", input, true);
  return output;
}

export const getPnlTool: ToolDefinition<GetPnlInput, Awaited<ReturnType<typeof run>>> = {
  name: "getPnl",
  description:
    "Authoritative P&L for an org and period. Give year+month or startDate+endDate. Returns revenue, COGS, opex, gross profit/margin from posted GL lines.",
  inputSchema: getPnlInput,
  execute: run,
};
