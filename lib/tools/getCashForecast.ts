import { z } from "zod";
import { projectCash } from "../financial/cashForecast";
import { orgIdSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const getCashForecastInput = z.object({
  orgId: orgIdSchema,
  asOf: z.string().datetime({ offset: true }).optional(),
  weeks: z.number().int().min(1).max(26).default(13),
  requiredMinimum: z.number().nonnegative().optional(),
});

export type GetCashForecastInput = z.infer<typeof getCashForecastInput>;

async function run(input: GetCashForecastInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  let asOf: Date | undefined;
  if (input.asOf) {
    asOf = new Date(input.asOf);
    if (Number.isNaN(asOf.getTime())) throw new ToolError("INVALID_RANGE", "invalid asOf date");
  }
  try {
    const output = await projectCash(ctx.db, input.orgId, {
      ...(asOf ? { asOf } : {}),
      weeks: input.weeks,
      ...(input.requiredMinimum !== undefined ? { requiredMinimum: input.requiredMinimum } : {}),
    });
    await auditToolCall(ctx, "getCashForecast", input, true);
    return output;
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError("INVALID_RANGE", e instanceof Error ? e.message : "invalid forecast range");
  }
}

export const getCashForecastTool: ToolDefinition<GetCashForecastInput, Awaited<ReturnType<typeof run>>> = {
  name: "getCashForecast",
  description:
    "13-week cash projection (default asOf 2025-01-01): opening bank balance + haircut-adjusted AR collections (overdue trickles over leading weeks) − firm AP outflows − payroll/opex/COGS run-rates from trailing GL. January overlaps known bills with run-rate (conservative). Returns weekly balances, minimum, and shortfall vs the floor.",
  inputSchema: getCashForecastInput,
  execute: run,
};
