// DB-backed cash + budget services. Deterministic: same rows → same numbers.
// The LLM never computes these; tools call these services, which query
// Prisma, which reads PostgreSQL. Agent → Tool → Service → Prisma → PG.
//
// Sign convention: BankTransaction.amount is signed — +inflow (collections),
// −outflow (payments, payroll, opex). Balance = opening + Σ(amount).

import type { PrismaClient } from "@prisma/client";
import { fetchMonthlyPnl } from "./pnl";
import { calculateVariance, calculateVariancePercent, round2 } from "./calculations";

export interface BankLeg {
  id: string;
  bankAccountId: string;
  date: Date;
  description: string;
  amount: unknown;
  status: string;
  invoiceId: string | null;
}

export interface BankBalanceRow {
  bankAccountId: string;
  name: string;
  opening: number;
  inflow: number;
  outflow: number;
  balance: number;
}

export async function fetchBankTransactions(
  db: PrismaClient,
  orgId: string,
  opts: { bankAccountId?: string; status?: string; start?: Date; end?: Date } = {}
): Promise<BankLeg[]> {
  if (!orgId) throw new Error("orgId is required");
  const { start, end } = opts;
  if (start && Number.isNaN(start.getTime())) throw new Error("invalid start date");
  if (end && Number.isNaN(end.getTime())) throw new Error("invalid end date");
  if (start && end && start >= end) throw new Error("invalid date range: start must be before end");
  if (opts.status !== undefined && opts.status !== "PENDING" && opts.status !== "RECONCILED") {
    throw new Error(`invalid status: ${opts.status}`);
  }
  const rows = await db.bankTransaction.findMany({
    where: {
      orgId,
      ...(opts.bankAccountId ? { bankAccountId: opts.bankAccountId } : {}),
      ...(opts.status ? { status: opts.status as never } : {}),
      ...(start || end
        ? { date: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  return rows as unknown as BankLeg[];
}

/** Pure balance aggregation — unit-testable without a DB. Rounds once. */
export function computeBankBalances(
  accounts: Array<{ id: string; name: string; openingBalance: unknown }>,
  legs: Array<{ bankAccountId: string; date: Date | string; amount: unknown }>,
  asOf?: Date
): { rows: BankBalanceRow[]; total: number } {
  const asOfMs = asOf ? asOf.getTime() : Number.POSITIVE_INFINITY;
  const raw = new Map<string, { name: string; opening: number; inflow: number; outflow: number }>();
  for (const a of accounts) {
    const opening = Number(a.openingBalance ?? 0);
    if (!Number.isFinite(opening)) throw new Error(`invalid opening balance for ${a.name}`);
    raw.set(a.id, { name: a.name, opening, inflow: 0, outflow: 0 });
  }
  for (const l of legs) {
    if (new Date(l.date).getTime() > asOfMs) continue;
    const acc = raw.get(l.bankAccountId);
    if (!acc) continue; // leg for an unknown account — ignore, never fabricate
    const amount = Number(l.amount);
    if (!Number.isFinite(amount)) throw new Error(`invalid bank amount: ${String(l.amount)}`);
    if (amount >= 0) acc.inflow += amount;
    else acc.outflow += -amount;
  }
  const rows: BankBalanceRow[] = [...raw.entries()].map(([bankAccountId, r]) => ({
    bankAccountId,
    name: r.name,
    opening: round2(r.opening),
    inflow: round2(r.inflow),
    outflow: round2(r.outflow),
    balance: round2(r.opening + r.inflow - r.outflow),
  }));
  rows.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { rows, total: round2(rows.reduce((s, r) => s + r.balance, 0)) };
}

export async function getBankBalance(
  db: PrismaClient,
  orgId: string,
  opts: { bankAccountId?: string; asOf?: Date } = {}
): Promise<{ rows: BankBalanceRow[]; total: number; asOf: string | null }> {
  if (!orgId) throw new Error("orgId is required");
  if (opts.asOf && Number.isNaN(opts.asOf.getTime())) throw new Error("invalid asOf date");
  const [accounts, legs] = await Promise.all([
    db.bankAccount.findMany({
      where: { orgId, ...(opts.bankAccountId ? { id: opts.bankAccountId } : {}) },
      orderBy: { name: "asc" },
    }),
    fetchBankTransactions(db, orgId, {
      ...(opts.bankAccountId ? { bankAccountId: opts.bankAccountId } : {}),
    }),
  ]);
  const { rows, total } = computeBankBalances(accounts, legs, opts.asOf);
  return { rows, total, asOf: opts.asOf ? opts.asOf.toISOString() : null };
}

export interface BudgetVarianceRow {
  accountCode: string;
  accountName: string;
  type: string;
  budgeted: number;
  actual: number;
  variance: number;
  variancePercent: number;
}

/** Budget vs actual for one month. Actuals come from the posted GL (fetchMonthlyPnl). */
export async function budgetVsActual(
  db: PrismaClient,
  orgId: string,
  year: number,
  month: number
): Promise<{ year: number; month: number; rows: BudgetVarianceRow[]; totalBudgeted: number; totalActual: number }> {
  if (!orgId) throw new Error("orgId is required");
  const [budgets, pnl] = await Promise.all([
    db.budget.findMany({
      where: { orgId, year, month },
      include: { account: true },
      orderBy: { account: { code: "asc" } },
    }),
    fetchMonthlyPnl(db, orgId, year, month),
  ]);
  const actualByCode = new Map(pnl.byAccount.map((a) => [a.code, a.balance]));
  // Revenue actuals are credits; everything else reads as booked balance.
  const rows: BudgetVarianceRow[] = budgets.map((b) => {
    const budgeted = Number(b.amount);
    const actual = actualByCode.get(b.account.code) ?? 0;
    return {
      accountCode: b.account.code,
      accountName: b.account.name,
      type: b.account.type,
      budgeted: round2(budgeted),
      actual: round2(actual),
      variance: calculateVariance(actual, budgeted),
      variancePercent: calculateVariancePercent(actual, budgeted),
    };
  });
  rows.sort((a, b) => (a.accountCode < b.accountCode ? -1 : 1));
  return {
    year,
    month,
    rows,
    totalBudgeted: round2(rows.reduce((s, r) => s + r.budgeted, 0)),
    totalActual: round2(rows.reduce((s, r) => s + r.actual, 0)),
  };
}
