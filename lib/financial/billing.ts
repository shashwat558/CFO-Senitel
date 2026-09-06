// Customer billing comparison — actual vs trailing-average expectation.
// The expectation is a heuristic (prior-3-month mean), never a contract: it
// flags candidates for investigation, and every non-OK verdict ships with the
// caveat that only source documents settle it.

import type { PrismaClient } from "@prisma/client";
import { calculateVariance, calculateVariancePercent, round2 } from "./calculations";

export type BillingVerdict =
  | "OK"
  | "MISSING_INVOICE"
  | "UNDER_BILLING"
  | "OVER_BILLING"
  | "TIMING";

const TOLERANCE = 0.15; // ±15% counts as normal noise

/** Pure classifier — unit-testable without a DB. */
export function classifyBilling(args: {
  actual: number;
  count: number;
  expected: number;
  usualCount: number;
}): { verdict: BillingVerdict; note: string } {
  const { actual, count, expected, usualCount } = args;
  if (expected === 0) {
    return actual === 0
      ? { verdict: "OK", note: "nothing billed and nothing expected" }
      : { verdict: "TIMING", note: "billing with no trailing history — new or restarted billing, verify against source documents" };
  }
  const ratio = actual / expected;
  if (Math.abs(1 - ratio) <= TOLERANCE && count === usualCount) {
    return { verdict: "OK", note: "within ±15% of trailing average with the usual invoice count" };
  }
  if (count < usualCount && ratio < 1 - TOLERANCE) {
    return {
      verdict: "MISSING_INVOICE",
      note: `only ${count} invoice(s) vs usual ${usualCount} with billing down — a split may never have been billed`,
    };
  }
  if (count !== usualCount) {
    return {
      verdict: "TIMING",
      note: `invoice count changed (${count} vs usual ${usualCount}) — likely a re-split or timing shift, verify against source documents`,
    };
  }
  if (ratio < 1 - TOLERANCE) {
    return { verdict: "UNDER_BILLING", note: "full invoice count but materially light — check pricing/discounts" };
  }
  return { verdict: "OVER_BILLING", note: "above trailing average — check duplicate or pull-forward billing" };
}

export async function compareCustomerBilling(
  db: PrismaClient,
  orgId: string,
  customerId: string,
  year: number,
  month: number
): Promise<{
  customerId: string;
  customerName: string;
  year: number;
  month: number;
  actual: number;
  invoiceCount: number;
  expected: number;
  usualCount: number;
  variance: number;
  variancePercent: number;
  verdict: BillingVerdict;
  note: string;
  caveat: string;
}> {
  if (!orgId) throw new Error("orgId is required");
  const customer = await db.customer.findFirst({ where: { id: customerId, orgId } });
  if (!customer) throw new Error("customer not found");
  const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 1));

  const current = await db.invoice.findMany({
    where: {
      orgId, customerId, type: "AR", status: { not: "VOID" },
      issueDate: { gte: monthStart(year, month), lt: monthEnd(year, month) },
    },
  });
  const prior: Array<{ total: number; count: number }> = [];
  for (let back = 1; back <= 3; back++) {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    const rows = await db.invoice.findMany({
      where: {
        orgId, customerId, type: "AR", status: { not: "VOID" },
        issueDate: { gte: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), lt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) },
      },
    });
    prior.push({
      total: rows.reduce((s, r) => s + Number(r.total), 0),
      count: rows.length,
    });
  }
  const actual = round2(current.reduce((s, r) => s + Number(r.total), 0));
  const expected = round2(prior.reduce((s, p) => s + p.total, 0) / 3);
  // Usual count = most common trailing count, tie → latest month.
  const counts = prior.map((p) => p.count);
  const freq = new Map<number, number>();
  for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
  const usualCount = counts.reduce((best, c) =>
    (freq.get(c) ?? 0) > (freq.get(best) ?? 0) ? c : best, counts[0] ?? 0);

  const { verdict, note } = classifyBilling({ actual, count: current.length, expected, usualCount });
  return {
    customerId,
    customerName: (customer as { name: string }).name,
    year,
    month,
    actual,
    invoiceCount: current.length,
    expected,
    usualCount,
    variance: calculateVariance(actual, expected),
    variancePercent: calculateVariancePercent(actual, expected),
    verdict,
    note,
    caveat: "trailing average is a heuristic, not a contract — confirm against source documents",
  };
}
