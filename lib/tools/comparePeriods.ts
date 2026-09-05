import { z } from "zod";
import { fetchMonthlyPnl } from "../financial/pnl";
import { calculateVariance, calculateVariancePercent } from "../financial/calculations";
import { monthSchema, orgIdSchema, yearSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, type ToolContext, type ToolDefinition } from "./types";

const METRICS = ["revenue", "cogs", "opex", "grossProfit", "grossMargin", "netIncome"] as const;
export type CompareMetric = (typeof METRICS)[number];

export const comparePeriodsInput = z.object({
  orgId: orgIdSchema,
  currentYear: yearSchema,
  currentMonth: monthSchema,
  previousYear: yearSchema,
  previousMonth: monthSchema,
  metric: z.enum(METRICS),
});

export type ComparePeriodsInput = z.infer<typeof comparePeriodsInput>;

async function run(input: ComparePeriodsInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  const [cur, prev] = await Promise.all([
    fetchMonthlyPnl(ctx.db, input.orgId, input.currentYear, input.currentMonth),
    fetchMonthlyPnl(ctx.db, input.orgId, input.previousYear, input.previousMonth),
  ]);
  const current = cur[input.metric];
  const previous = prev[input.metric];
  const output = {
    metric: input.metric,
    current,
    previous,
    variance: calculateVariance(current, previous),
    variancePercent: calculateVariancePercent(current, previous),
    currentPeriod: { year: input.currentYear, month: input.currentMonth },
    previousPeriod: { year: input.previousYear, month: input.previousMonth },
  };
  await auditToolCall(ctx, "comparePeriods", input, true);
  return output;
}

export const comparePeriodsTool: ToolDefinition<ComparePeriodsInput, Awaited<ReturnType<typeof run>>> = {
  name: "comparePeriods",
  description:
    "Compare one P&L metric between two months. Returns absolute and percent variance computed deterministically.",
  inputSchema: comparePeriodsInput,
  execute: run,
};
