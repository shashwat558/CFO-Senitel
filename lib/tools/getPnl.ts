import { z } from "zod";
import { fetchMonthlyPnl, fetchPnl } from "../financial/pnl";
import { auditToolCall, ensureOrgMatch, type ToolContext, type ToolDefinition } from "./types";

export const getPnlInput = z
  .object({
    orgId: z.string().min(1),
    year: z.number().int().min(2000).max(2100).optional(),
    month: z.number().int().min(1).max(12).optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (v) =>
      (v.year !== undefined && v.month !== undefined) ||
      (v.startDate !== undefined && v.endDate !== undefined),
    { message: "provide either (year + month) or (startDate + endDate)" }
  );

export type GetPnlInput = z.infer<typeof getPnlInput>;

async function run(input: GetPnlInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  const summary =
    input.year !== undefined && input.month !== undefined
      ? await fetchMonthlyPnl(ctx.db, input.orgId, input.year, input.month)
      : await fetchPnl(ctx.db, input.orgId, new Date(input.startDate!), new Date(input.endDate!));
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
