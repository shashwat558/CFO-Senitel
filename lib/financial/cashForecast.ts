// 13-week cash forecast — deterministic projection from real rows.
//
// Inflows: unpaid AR due inside the window, haircut by days overdue at asOf
// (overdue dollars collect worse — documented rates below, not model output).
// Outflows: unpaid AP due in full (obligations are firm) + payroll/opex
// run-rates derived from trailing posted GL (data-driven, never constants).
// Policy: MINIMUM_CASH_FLOOR breaches define the shortfall.

import type { PrismaClient } from "@prisma/client";
import { getBankBalance } from "./cash";
import { round2 } from "./calculations";

// Policy floor for the 13-week outlook: ~4 weeks of typical outflows
// (~$1M/month burn). A minimum below this is a cash problem by definition.
export const MINIMUM_CASH_FLOOR = 1000000;
export const DEFAULT_WEEKS = 13;
export const DAY_MS = 86400000;

/** Collection haircut by days overdue at asOf — a documented assumption. */
export function collectionRate(daysOverdue: number): number {
  if (daysOverdue <= 0) return 1;
  if (daysOverdue <= 30) return 0.85;
  if (daysOverdue <= 60) return 0.6;
  return 0.4;
}

/**
 * Over how many leading weeks an overdue balance is expected to arrive.
 * Stale receivables do NOT clear in week 1 — they trickle. Amounts falling
 * past the window are out of forecast scope (documented, never invented).
 */
export function collectionSpreadWeeks(daysOverdue: number): number {
  if (daysOverdue <= 0) return 1;
  if (daysOverdue <= 30) return 4;
  if (daysOverdue <= 60) return 8;
  return 13;
}

/**
 * Whether an overdue balance belongs in a near-term forecast at all.
 * Balances 90+ days past due are doubtful — counted at zero here (they need
 * collection action or allowance, not forecast credit).
 */
export function isDoubtful(daysOverdue: number): boolean {
  return daysOverdue > 90;
}

export interface CashWeek {
  weekStart: string;
  inflow: number;
  outflow: number;
  net: number;
  balance: number;
}

export interface CashDriver {
  label: string;
  kind: "delayed-collection" | "scheduled-outflow";
  amount: number;
}

async function monthlyRunRate(
  db: PrismaClient,
  orgId: string,
  accountCode: string,
  asOf: Date
): Promise<number> {
  // Trailing-3-month average of posted debits on one expense account.
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 3, 1));
  const lines = await db.transaction.findMany({
    where: {
      orgId,
      date: { gte: start, lt: asOf },
      account: { code: accountCode, type: "EXPENSE" },
    },
    select: { debit: true, credit: true },
  });
  let net = 0;
  for (const l of lines) net += Number(l.debit) - Number(l.credit);
  return net / 3;
}

async function monthlyTypeRunRate(
  db: PrismaClient,
  orgId: string,
  type: "COGS" | "EXPENSE",
  asOf: Date
): Promise<number> {
  // Trailing-3-month average of posted debits across a whole account type —
  // the run-rate for operating outflows with no bill yet (future purchasing).
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 3, 1));
  const lines = await db.transaction.findMany({
    where: {
      orgId,
      date: { gte: start, lt: asOf },
      account: { type },
    },
    select: { debit: true, credit: true },
  });
  let net = 0;
  for (const l of lines) net += Number(l.debit) - Number(l.credit);
  return net / 3;
}

export async function projectCash(
  db: PrismaClient,
  orgId: string,
  opts: { asOf?: Date; weeks?: number; requiredMinimum?: number } = {}
): Promise<{
  asOf: string;
  weeks: CashWeek[];
  opening: number;
  totalInflow: number;
  totalOutflow: number;
  minBalance: number;
  minWeekStart: string;
  requiredMinimum: number;
  shortfall: number;
  drivers: CashDriver[];
}> {
  if (!orgId) throw new Error("orgId is required");
  const asOf = opts.asOf ?? new Date("2025-01-01T00:00:00.000Z");
  if (Number.isNaN(asOf.getTime())) throw new Error("invalid asOf date");
  const weeks = opts.weeks ?? DEFAULT_WEEKS;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 26) {
    throw new Error("weeks must be an integer 1..26");
  }
  const requiredMinimum = opts.requiredMinimum ?? MINIMUM_CASH_FLOOR;
  const end = new Date(asOf.getTime() + weeks * 7 * DAY_MS);

  const [{ total: opening }, ar, ap] = await Promise.all([
    getBankBalance(db, orgId, { asOf }),
    db.invoice.findMany({
      where: { orgId, type: "AR", status: { in: ["SENT", "OVERDUE"] } },
      include: { customer: true },
    }),
    db.invoice.findMany({
      where: { orgId, type: "AP", status: { in: ["SENT", "OVERDUE"] } },
      include: { vendor: true },
    }),
  ]);

  const weekIndex = (d: Date): number => {
    if (d < asOf) return 0; // overdue/due-today collects or pays in week 1
    return Math.min(weeks - 1, Math.floor((d.getTime() - asOf.getTime()) / (7 * DAY_MS)));
  };

  // Forward sales: BASE revenue forecasts inside the window collect ~30 days
  // after month-start (standard terms). Without this the forecast pretends
  // the business stops selling — far more wrong than projecting the plan.
  const forecasts = await db.forecast.findMany({
    where: { orgId, metric: "REVENUE", scenario: "BASE" },
  });
  const forwardSales: Array<{ week: number; amount: number; label: string }> = [];
  for (const f of forecasts as Array<{ year: number; month: number; amount: unknown }>) {
    const collectAt = new Date(Date.UTC(f.year, f.month - 1, 1) + 30 * DAY_MS);
    if (collectAt < asOf || collectAt >= end) continue;
    const amount = Number(f.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    forwardSales.push({
      week: weekIndex(collectAt),
      amount,
      label: `forecast ${f.year}-${String(f.month).padStart(2, "0")} collections`,
    });
  }

  const inflow = new Array<number>(weeks).fill(0);
  const outflow = new Array<number>(weeks).fill(0);
  const drivers: CashDriver[] = [];
  for (const s of forwardSales) inflow[s.week] += s.amount;

  for (const inv of ar as Array<{
    invoiceNumber: string; total: unknown; dueDate: Date | null; issueDate: Date;
    customer: { name: string } | null;
  }>) {
    const total = Number(inv.total);
    if (!Number.isFinite(total)) throw new Error("invalid AR total");
    const base = inv.dueDate ?? inv.issueDate;
    if (new Date(base) >= end) continue; // beyond the window
    const daysOverdue = Math.floor((asOf.getTime() - new Date(base).getTime()) / DAY_MS);
    if (isDoubtful(daysOverdue)) {
      drivers.push({
        label: `${inv.invoiceNumber} (${inv.customer?.name ?? "Unknown"}) ${daysOverdue}d overdue — doubtful, excluded`,
        kind: "delayed-collection",
        amount: round2(total),
      });
      continue;
    }
    const expected = total * collectionRate(daysOverdue);
    if (daysOverdue <= 0) {
      inflow[weekIndex(new Date(base))] += expected;
    } else {
      // Overdue balances trickle in over the leading weeks, not week 1.
      const span = Math.min(collectionSpreadWeeks(daysOverdue), weeks);
      for (let w = 0; w < span; w++) inflow[w] += expected / span;
    }
    if (daysOverdue > 0) {
      drivers.push({
        label: `${inv.invoiceNumber} (${inv.customer?.name ?? "Unknown"}) ${daysOverdue}d overdue`,
        kind: "delayed-collection",
        amount: round2(total - expected),
      });
    }
  }
  for (const bill of ap as Array<{
    invoiceNumber: string; total: unknown; dueDate: Date | null; issueDate: Date;
    vendor: { name: string } | null;
  }>) {
    const total = Number(bill.total);
    if (!Number.isFinite(total)) throw new Error("invalid AP total");
    const base = bill.dueDate ?? bill.issueDate;
    if (new Date(base) >= end) continue;
    const w = weekIndex(new Date(base));
    outflow[w] += total;
    if (total >= 100000) {
      drivers.push({
        label: `${bill.invoiceNumber} (${bill.vendor?.name ?? "Unknown"}) due ${new Date(base).toISOString().slice(0, 10)}`,
        kind: "scheduled-outflow",
        amount: round2(total),
      });
    }
  }

  // Recurring run-rates from trailing posted GL, spread weekly: payroll and
  // opex plus projected COGS purchasing (future bills not yet invoiced).
  // January carries both known bills and run-rate — disclosed as conservative
  // overlap in the tool description rather than silently netted.
  const [payrollMo, rentMo, utilMo, cogsMo] = await Promise.all([
    monthlyRunRate(db, orgId, "6000", asOf),
    monthlyRunRate(db, orgId, "6010", asOf),
    monthlyRunRate(db, orgId, "6020", asOf),
    monthlyTypeRunRate(db, orgId, "COGS", asOf),
  ]);
  const weeklyPayroll = (payrollMo * 12) / 52;
  const weeklyOpex = ((rentMo + utilMo) * 12) / 52;
  const weeklyCogs = (cogsMo * 12) / 52;
  for (let w = 0; w < weeks; w++) outflow[w] += weeklyPayroll + weeklyOpex + weeklyCogs;

  const weekRows: CashWeek[] = [];
  let balance = opening;
  let minBalance = opening;
  let minWeek = 0;
  for (let w = 0; w < weeks; w++) {
    const i = round2(inflow[w]);
    const o = round2(outflow[w]);
    balance = round2(balance + i - o);
    weekRows.push({
      weekStart: new Date(asOf.getTime() + w * 7 * DAY_MS).toISOString(),
      inflow: i,
      outflow: o,
      net: round2(i - o),
      balance,
    });
    if (balance < minBalance) {
      minBalance = balance;
      minWeek = w;
    }
  }
  drivers.sort((a, b) => b.amount - a.amount);

  return {
    asOf: asOf.toISOString(),
    weeks: weekRows,
    opening,
    totalInflow: round2(weekRows.reduce((s, r) => s + r.inflow, 0)),
    totalOutflow: round2(weekRows.reduce((s, r) => s + r.outflow, 0)),
    minBalance,
    minWeekStart: weekRows[minWeek].weekStart,
    requiredMinimum,
    shortfall: round2(Math.max(0, requiredMinimum - minBalance)),
    drivers,
  };
}
