import { z } from "zod";
import { fetchMonthlyPnl, fetchVendorSpend, getPeriodBounds } from "../financial/pnl";
import { calculateVendorContribution, round2 } from "../financial/calculations";
import { monthSchema, orgIdSchema, yearSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const breakDownMetricInput = z.object({
  orgId: orgIdSchema,
  metric: z.enum(["cogs", "revenue", "opex"]),
  year: yearSchema,
  month: monthSchema,
});

export type BreakDownMetricInput = z.infer<typeof breakDownMetricInput>;

async function run(input: BreakDownMetricInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  const { start, end } = getPeriodBounds(input.year, input.month);

  if (input.metric === "cogs") {
    const { rows, total } = await fetchVendorSpend(ctx.db, input.orgId, start, end);
    const output = {
      metric: input.metric as string,
      total,
      rows: rows.map((r) => ({
        key: r.vendorName,
        vendorId: r.vendorId,
        amount: r.totalSpend,
        contributionPercent: calculateVendorContribution(r.totalSpend, total),
        invoiceCount: r.invoiceCount,
      })),
    };
    await auditToolCall(ctx, "breakDownMetric", input, true);
    return output;
  }

  if (input.metric === "revenue") {
    const invoices = await ctx.db.invoice.findMany({
      where: {
        orgId: input.orgId, type: "AR", status: { not: "VOID" },
        issueDate: { gte: start, lt: end },
      },
      include: { customer: true },
      orderBy: { issueDate: "asc" },
      take: 500,
    });
    // Key by customerId (not name) so same-named customers never merge;
    // null-customer rows share one explicit Unknown bucket.
    const map = new Map<string, { key: string; customerId: string | null; amount: number; invoiceCount: number }>();
    let rawTotal = 0;
    for (const inv of invoices) {
      const amount = Number(inv.total);
      if (!Number.isFinite(amount)) throw new ToolError("DATA", "invalid invoice total");
      rawTotal += amount;
      const idKey = inv.customerId ?? "unknown";
      const label = inv.customer?.name ?? "Unknown";
      const cur = map.get(idKey) ?? { key: label, customerId: inv.customerId ?? null, amount: 0, invoiceCount: 0 };
      cur.amount += amount;
      cur.invoiceCount += 1;
      map.set(idKey, cur);
    }
    const rows = [...map.values()]
      .map((r) => ({ ...r, amount: round2(r.amount) }))
      .sort((a, b) => b.amount - a.amount || (a.key < b.key ? -1 : 1));
    const total = round2(rawTotal);
    const output = {
      metric: input.metric as string, total,
      rows: rows.map((r) => ({ ...r, contributionPercent: calculateVendorContribution(r.amount, total) })),
    };
    await auditToolCall(ctx, "breakDownMetric", input, true);
    return output;
  }

  // opex by GL account
  const pnl = await fetchMonthlyPnl(ctx.db, input.orgId, input.year, input.month);
  const rows = pnl.byAccount
    .filter((a) => a.type === "EXPENSE")
    .sort((a, b) => b.balance - a.balance)
    .map((a) => ({
      key: `${a.code} ${a.name}`,
      amount: a.balance,
      contributionPercent: calculateVendorContribution(a.balance, pnl.opex),
      invoiceCount: 0,
    }));
  const output = { metric: input.metric as string, total: pnl.opex, rows };
  await auditToolCall(ctx, "breakDownMetric", input, true);
  return output;
}

export const breakDownMetricTool: ToolDefinition<BreakDownMetricInput, Awaited<ReturnType<typeof run>>> = {
  name: "breakDownMetric",
  description:
    "Break a P&L metric into components for one month: COGS by vendor, revenue by customer, opex by GL account.",
  inputSchema: breakDownMetricInput,
  execute: run,
};
