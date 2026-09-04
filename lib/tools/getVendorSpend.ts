import { z } from "zod";
import { fetchVendorSpend } from "../financial/pnl";
import { calculateVendorContribution } from "../financial/calculations";
import { auditToolCall, ensureOrgMatch, type ToolContext, type ToolDefinition } from "./types";

export const getVendorSpendInput = z.object({
  orgId: z.string().min(1),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  vendorId: z.string().min(1).optional(),
});

export type GetVendorSpendInput = z.infer<typeof getVendorSpendInput>;

async function run(input: GetVendorSpendInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new Error("invalid date range: startDate must be before endDate");
  }
  const { rows, total } = await fetchVendorSpend(ctx.db, input.orgId, start, end, input.vendorId);
  const output = {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    total,
    vendors: rows.map((r) => ({
      ...r,
      contributionPercent: calculateVendorContribution(r.totalSpend, total),
    })),
  };
  await auditToolCall(ctx, "getVendorSpend", input, true);
  return output;
}

export const getVendorSpendTool: ToolDefinition<GetVendorSpendInput, Awaited<ReturnType<typeof run>>> = {
  name: "getVendorSpend",
  description:
    "Total AP spend grouped by vendor for a period (excludes VOID invoices). Use to find which supplier drove a cost change.",
  inputSchema: getVendorSpendInput,
  execute: run,
};
