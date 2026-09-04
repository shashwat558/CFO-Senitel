// DB-backed P&L aggregation. Deterministic: same rows → same numbers.
// The LLM never computes these; tools call these services, which query
// Prisma, which reads PostgreSQL. Agent → Tool → Service → Prisma → PG.
//
// Sign conventions (documented once, used everywhere):
// - REVENUE balance = SUM(credit − debit) over REVENUE accounts.
// - COGS / EXPENSE balance = SUM(debit − credit) over those accounts.
// - Vendor spend = SUM(AP invoice totals, excluding VOID), grouped by vendor.
//   Invoice-based so every dollar traces to an invoice row (evidence).

import type { PrismaClient } from "@prisma/client";
import {
  calculateGrossMargin,
  calculateGrossProfit,
  round2,
} from "./calculations";

export interface PeriodBounds {
  start: Date;
  end: Date; // exclusive upper bound
}

/** UTC month window [start, end). Throws on invalid year/month. */
export function getPeriodBounds(year: number, month: number): PeriodBounds {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`invalid year: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`invalid month: ${month}`);
  }
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

export interface PnlSummary {
  orgId: string;
  start: Date;
  end: Date;
  revenue: number;
  cogs: number;
  opex: number;
  grossProfit: number;
  grossMargin: number; // percent 0-100
  netIncome: number; // grossProfit − opex
  byAccount: Array<{
    accountId: string;
    code: string;
    name: string;
    type: string;
    balance: number;
  }>;
}

type TxWithAccount = {
  debit: unknown;
  credit: unknown;
  account: { id: string; code: string; name: string; type: string };
};

const toNum = (v: unknown): number => Number(v ?? 0);

/** Pure aggregation over already-fetched lines — unit-testable without a DB. */
export function aggregatePnl(
  orgId: string,
  start: Date,
  end: Date,
  lines: TxWithAccount[]
): PnlSummary {
  let revenue = 0;
  let cogs = 0;
  let opex = 0;
  const byAccount = new Map<
    string,
    { accountId: string; code: string; name: string; type: string; balance: number }
  >();

  // Deterministic order regardless of DB return order.
  const sorted = [...lines].sort((a, b) =>
    a.account.code < b.account.code ? -1 : a.account.code > b.account.code ? 1 : 0
  );

  for (const l of sorted) {
    const debit = toNum(l.debit);
    const credit = toNum(l.credit);
    const t = l.account.type;
    let signed = 0;
    if (t === "REVENUE") {
      signed = credit - debit;
      revenue += signed;
    } else if (t === "COGS") {
      signed = debit - credit;
      cogs += signed;
    } else if (t === "EXPENSE") {
      signed = debit - credit;
      opex += signed;
    } else {
      continue; // balance-sheet accounts don't enter P&L
    }
    const cur = byAccount.get(l.account.id) ?? {
      accountId: l.account.id,
      code: l.account.code,
      name: l.account.name,
      type: t,
      balance: 0,
    };
    cur.balance = round2(cur.balance + signed);
    byAccount.set(l.account.id, cur);
  }

  revenue = round2(revenue);
  cogs = round2(cogs);
  opex = round2(opex);
  const grossProfit = calculateGrossProfit(revenue, cogs);
  const grossMargin = calculateGrossMargin(revenue, cogs);
  return {
    orgId,
    start,
    end,
    revenue,
    cogs,
    opex,
    grossProfit,
    grossMargin,
    netIncome: round2(grossProfit - opex),
    byAccount: [...byAccount.values()],
  };
}

export async function fetchPnl(
  db: PrismaClient,
  orgId: string,
  start: Date,
  end: Date
): Promise<PnlSummary> {
  if (!orgId) throw new Error("orgId is required");
  const s = start instanceof Date ? start : new Date(start);
  const e = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s >= e) {
    throw new Error("invalid date range: start must be before end");
  }
  const lines = await db.transaction.findMany({
    where: {
      orgId,
      date: { gte: s, lt: e },
      journalEntry: { status: "POSTED" },
      account: { type: { in: ["REVENUE", "COGS", "EXPENSE"] } },
    },
    include: { account: true },
  });
  return aggregatePnl(orgId, s, e, lines as unknown as TxWithAccount[]);
}

export async function fetchMonthlyPnl(
  db: PrismaClient,
  orgId: string,
  year: number,
  month: number
): Promise<PnlSummary> {
  const { start, end } = getPeriodBounds(year, month);
  return fetchPnl(db, orgId, start, end);
}

export interface VendorSpendRow {
  vendorId: string;
  vendorName: string;
  vendorCode: string;
  invoiceCount: number;
  totalSpend: number;
}

export async function fetchVendorSpend(
  db: PrismaClient,
  orgId: string,
  start: Date,
  end: Date,
  vendorId?: string
): Promise<{ rows: VendorSpendRow[]; total: number; start: Date; end: Date }> {
  if (!orgId) throw new Error("orgId is required");
  const invoices = await db.invoice.findMany({
    where: {
      orgId,
      type: "AP",
      status: { not: "VOID" },
      issueDate: { gte: start, lt: end },
      ...(vendorId ? { vendorId } : {}),
      vendorId: vendorId ?? { not: null },
    },
    include: { vendor: true },
    orderBy: [{ issueDate: "asc" }, { invoiceNumber: "asc" }],
  });
  const map = new Map<string, VendorSpendRow>();
  for (const inv of invoices) {
    if (!inv.vendor) continue;
    const cur = map.get(inv.vendorId!) ?? {
      vendorId: inv.vendorId!,
      vendorName: inv.vendor.name,
      vendorCode: inv.vendor.code,
      invoiceCount: 0,
      totalSpend: 0,
    };
    cur.invoiceCount += 1;
    cur.totalSpend = round2(cur.totalSpend + Number(inv.total));
    map.set(inv.vendorId!, cur);
  }
  const rows = [...map.values()].sort((a, b) => b.totalSpend - a.totalSpend);
  return { rows, total: round2(rows.reduce((s, r) => s + r.totalSpend, 0)), start, end };
}
