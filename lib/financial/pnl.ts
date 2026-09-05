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

const toNum = (v: unknown, field: string): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "object" && v !== null && "toString" in v ? Number(v.toString()) : Number(v);
  if (!Number.isFinite(n)) throw new Error(`invalid ${field} amount: ${String(v)}`);
  return n;
};

/** Pure aggregation over already-fetched lines — unit-testable without a DB.
 * Precondition: `lines` must already be filtered to POSTED entries in
 * [start, end) over REVENUE/COGS/EXPENSE accounts (see fetchPnl). Balance-sheet
 * lines are ignored by design. Accumulates raw sums then rounds once so the
 * P&L foots exactly (no per-line rounding drift). */
export function aggregatePnl(
  orgId: string,
  start: Date,
  end: Date,
  lines: TxWithAccount[]
): PnlSummary {
  let revenue = 0;
  let cogs = 0;
  let opex = 0;
  // Raw (unrounded) per-account accumulators — rounded once at the end.
  const rawByAccount = new Map<
    string,
    { accountId: string; code: string; name: string; type: string; balance: number }
  >();

  // Deterministic order regardless of DB return order.
  const sorted = [...lines].sort((a, b) => {
    if (a.account.code !== b.account.code) return a.account.code < b.account.code ? -1 : 1;
    return a.account.id < b.account.id ? -1 : a.account.id > b.account.id ? 1 : 0;
  });

  for (const l of sorted) {
    const debit = toNum(l.debit, "debit");
    const credit = toNum(l.credit, "credit");
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
    const cur = rawByAccount.get(l.account.id) ?? {
      accountId: l.account.id,
      code: l.account.code,
      name: l.account.name,
      type: t,
      balance: 0,
    };
    cur.balance += signed;
    rawByAccount.set(l.account.id, cur);
  }

  revenue = round2(revenue);
  cogs = round2(cogs);
  opex = round2(opex);
  const byAccount = [...rawByAccount.values()].map((a) => ({ ...a, balance: round2(a.balance) }));
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
    byAccount,
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
  const s = start instanceof Date ? start : new Date(start);
  const e = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s >= e) {
    throw new Error("invalid date range: start must be before end");
  }
  const invoices = await db.invoice.findMany({
    where: {
      orgId,
      type: "AP",
      status: { not: "VOID" },
      issueDate: { gte: s, lt: e },
      ...(vendorId ? { vendorId } : { vendorId: { not: null } }),
    },
    include: { vendor: true },
    orderBy: [{ issueDate: "asc" }, { invoiceNumber: "asc" }],
  });
  // Raw accumulators (rounded once at the end to avoid drift).
  const map = new Map<string, { row: VendorSpendRow; raw: number }>();
  let orphanRaw = 0;
  let orphanCount = 0;
  for (const inv of invoices) {
    const amount = Number(inv.total);
    if (!Number.isFinite(amount)) throw new Error(`invalid invoice total: ${String(inv.total)}`);
    if (!inv.vendor || !inv.vendorId) {
      orphanRaw += amount;
      orphanCount += 1;
      continue;
    }
    const key = inv.vendorId;
    const entry = map.get(key) ?? {
      row: {
        vendorId: key,
        vendorName: inv.vendor.name,
        vendorCode: inv.vendor.code,
        invoiceCount: 0,
        totalSpend: 0,
      },
      raw: 0,
    };
    entry.row.invoiceCount += 1;
    entry.raw += amount;
    map.set(key, entry);
  }
  const rows: VendorSpendRow[] = [...map.values()].map(({ row, raw }) => ({
    ...row,
    totalSpend: round2(raw),
  }));
  if (orphanCount > 0) {
    rows.push({
      vendorId: "unknown",
      vendorName: "Unknown (no vendor)",
      vendorCode: "UNKNOWN",
      invoiceCount: orphanCount,
      totalSpend: round2(orphanRaw),
    });
  }
  rows.sort((a, b) => b.totalSpend - a.totalSpend || (a.vendorCode < b.vendorCode ? -1 : 1));
  const total = round2(rows.reduce((sum, r) => sum + r.totalSpend, 0));
  return { rows, total, start: s, end: e };
}
