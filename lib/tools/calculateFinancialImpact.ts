import { z } from "zod";
import { calculateFinancialImpact } from "../financial/calculations";
import { auditToolCall, type ToolContext, type ToolDefinition } from "./types";

export const calculateFinancialImpactInput = z.object({
  orgId: z.string().min(1),
  baselineUnitPrice: z.number().nonnegative(),
  actualUnitPrice: z.number().nonnegative(),
  quantity: z.number().nonnegative(),
});

export type CalculateFinancialImpactInput = z.infer<typeof calculateFinancialImpactInput>;

async function run(input: CalculateFinancialImpactInput, ctx: ToolContext) {
  if (input.orgId !== ctx.orgId) throw new Error("orgId does not match tool context");
  const output = calculateFinancialImpact(input);
  await auditToolCall(ctx, "calculateFinancialImpact", input, true);
  return output;
}

export const calculateFinancialImpactTool: ToolDefinition<
  CalculateFinancialImpactInput,
  Awaited<ReturnType<typeof run>>
> = {
  name: "calculateFinancialImpact",
  description:
    "Deterministic price-deviation impact: (actual − baseline) × quantity. Pure math, no DB. Use after compareVendorPrices to quantify an overcharge.",
  inputSchema: calculateFinancialImpactInput,
  execute: run,
};
