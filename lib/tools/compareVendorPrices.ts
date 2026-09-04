import { z } from "zod";
import { calculateFinancialImpact, calculateVariancePercent, round2 } from "../financial/calculations";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const compareVendorPricesInput = z.object({
  orgId: z.string().min(1),
  vendorId: z.string().min(1),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
});

export type CompareVendorPricesInput = z.infer<typeof compareVendorPricesInput>;

async function run(input: CompareVendorPricesInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);

  const contract = await ctx.db.contract.findFirst({
    where: { orgId: input.orgId, vendorId: input.vendorId, status: "ACTIVE" },
    orderBy: { startDate: "desc" },
    include: { vendor: true },
  });
  if (!contract) throw new ToolError("NOT_FOUND", "no active contract for vendor");

  const invoices = await ctx.db.invoice.findMany({
    where: {
      orgId: input.orgId, vendorId: input.vendorId, type: "AP",
      status: { not: "VOID" },
      issueDate: { gte: start, lt: end },
      unitPrice: { not: null },
      quantity: { not: null },
    },
    orderBy: { issueDate: "asc" },
  });
  if (invoices.length === 0) throw new ToolError("NO_DATA", "no priced AP invoices in range");

  const prices = invoices.map((i) => Number(i.unitPrice));
  const qtys = invoices.map((i) => Number(i.quantity));
  const totalQty = round2(qtys.reduce((s, q) => s + q, 0));
  const avgPrice = round2(prices.reduce((s, p, idx) => s + p * qtys[idx], 0) / (totalQty || 1));
  const baseline = Number(contract.unitPrice);
  const impact = calculateFinancialImpact({
    baselineUnitPrice: baseline,
    actualUnitPrice: avgPrice,
    quantity: totalQty,
  });

  const output = {
    vendor: { id: contract.vendor.id, name: contract.vendor.name, code: contract.vendor.code },
    contract: {
      contractNumber: contract.contractNumber,
      unitPrice: baseline,
      unitOfMeasure: contract.unitOfMeasure,
      material: contract.material,
    },
    period: { startDate: start.toISOString(), endDate: end.toISOString() },
    invoiceCount: invoices.length,
    totalQuantity: totalQty,
    avgUnitPrice: avgPrice,
    minUnitPrice: Math.min(...prices),
    maxUnitPrice: Math.max(...prices),
    unitVariance: impact.unitVariance,
    unitVariancePercent: impact.unitVariancePercent,
    avgVsContractPercent: calculateVariancePercent(avgPrice, baseline),
    estimatedImpact: impact.totalImpact,
    invoices: invoices.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      issueDate: i.issueDate.toISOString(),
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      total: Number(i.total),
    })),
  };
  await auditToolCall(ctx, "compareVendorPrices", input, true);
  return output;
}

export const compareVendorPricesTool: ToolDefinition<
  CompareVendorPricesInput,
  Awaited<ReturnType<typeof run>>
> = {
  name: "compareVendorPrices",
  description:
    "Compare a vendor's invoiced unit prices against its active contract price for a period. Returns variance and estimated overcharge impact.",
  inputSchema: compareVendorPricesInput,
  execute: run,
};
