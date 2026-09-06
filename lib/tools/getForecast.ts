import { z } from "zod";
import { monthSchema, orgIdSchema, yearSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

const FORECAST_METRICS = ["REVENUE", "COGS", "OPEX"] as const;

export const getForecastInput = z.object({
  orgId: orgIdSchema,
  metric: z.enum(FORECAST_METRICS),
  year: yearSchema,
  month: monthSchema,
  scenario: z.string().min(1).max(20).default("BASE"),
});

export type GetForecastInput = z.infer<typeof getForecastInput>;

async function run(input: GetForecastInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  const row = await ctx.db.forecast.findFirst({
    where: {
      orgId: input.orgId,
      metric: input.metric,
      year: input.year,
      month: input.month,
      scenario: input.scenario,
    },
  });
  if (!row) {
    throw new ToolError(
      "NOT_FOUND",
      `no ${input.scenario} forecast for ${input.metric} ${input.year}-${String(input.month).padStart(2, "0")}`
    );
  }
  const output = {
    id: row.id,
    metric: row.metric,
    year: row.year,
    month: row.month,
    scenario: row.scenario,
    amount: Number(row.amount),
  };
  await auditToolCall(ctx, "getForecast", input, true);
  return output;
}

export const getForecastTool: ToolDefinition<GetForecastInput, Awaited<ReturnType<typeof run>>> = {
  name: "getForecast",
  description:
    "Read one forecasted figure (BASE scenario seeded for revenue/COGS/opex). Compare against actuals to test whether a variance was expected.",
  inputSchema: getForecastInput,
  execute: run,
};
