// AR/AP aging — deterministic buckets over unpaid invoices.
// Unpaid = status SENT or OVERDUE. Buckets measure dueDate vs asOf; invoices
// without a dueDate age from issueDate. Pure bucketing + thin fetchers.

import type { PrismaClient } from "@prisma/client";
import { round2 } from "./calculations";

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export interface AgingRow {
  invoiceNumber: string;
  counterparty: string;
  issueDate: Date;
  dueDate: Date | null;
  daysOverdue: number;
  total: number;
  bucket: AgingBucket;
}

export function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

/** Pure aging over already-fetched invoice rows — unit-testable without a DB. */
export function ageInvoices(
  invoices: Array<{
    invoiceNumber: string;
    counterparty: string;
    issueDate: Date | string;
    dueDate: Date | string | null;
    total: unknown;
  }>,
  asOf: Date
): { rows: AgingRow[]; totals: Record<AgingBucket, number>; total: number } {
  const asOfMs = asOf.getTime();
  const rows: AgingRow[] = invoices.map((inv) => {
    const total = Number(inv.total);
    if (!Number.isFinite(total)) throw new Error(`invalid invoice total: ${String(inv.total)}`);
    const base = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.issueDate);
    const daysOverdue = Math.floor((asOfMs - base.getTime()) / 86400000);
    return {
      invoiceNumber: inv.invoiceNumber,
      counterparty: inv.counterparty,
      issueDate: new Date(inv.issueDate),
      dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
      daysOverdue,
      total: round2(total),
      bucket: bucketFor(daysOverdue),
    };
  });
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || (a.invoiceNumber < b.invoiceNumber ? -1 : 1));
  const totals = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
  for (const r of rows) totals[r.bucket] = round2(totals[r.bucket] + r.total);
  return { rows, total: round2(rows.reduce((s, r) => s + r.total, 0)), totals };
}

async function fetchUnpaid(
  db: PrismaClient,
  orgId: string,
  type: "AR" | "AP"
): Promise<Array<{ invoiceNumber: string; counterparty: string; issueDate: Date; dueDate: Date | null; total: unknown }>> {
  const rows = await db.invoice.findMany({
    where: { orgId, type, status: { in: ["SENT", "OVERDUE"] } },
    include: { vendor: true, customer: true },
    orderBy: [{ dueDate: "asc" }, { invoiceNumber: "asc" }],
  });
  return (rows as Array<{
    invoiceNumber: string;
    vendor: { name: string } | null;
    customer: { name: string } | null;
    issueDate: Date;
    dueDate: Date | null;
    total: unknown;
  }>).map((r) => ({
    invoiceNumber: r.invoiceNumber,
    counterparty: type === "AR" ? r.customer?.name ?? "Unknown" : r.vendor?.name ?? "Unknown",
    issueDate: r.issueDate,
    dueDate: r.dueDate,
    total: r.total,
  }));
}

export async function getArAging(db: PrismaClient, orgId: string, asOf: Date) {
  if (!orgId) throw new Error("orgId is required");
  if (Number.isNaN(asOf.getTime())) throw new Error("invalid asOf date");
  const aged = ageInvoices(await fetchUnpaid(db, orgId, "AR"), asOf);
  return { asOf: asOf.toISOString(), ...aged };
}

export async function getApAging(db: PrismaClient, orgId: string, asOf: Date) {
  if (!orgId) throw new Error("orgId is required");
  if (Number.isNaN(asOf.getTime())) throw new Error("invalid asOf date");
  const aged = ageInvoices(await fetchUnpaid(db, orgId, "AP"), asOf);
  return { asOf: asOf.toISOString(), ...aged };
}
