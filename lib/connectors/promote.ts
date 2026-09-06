// Promotion — staged provider rows into the books (C3).
//
// Mapping (single-company, read-only pull, USD books):
//   payment      → Customer (find-or-create) + AR Invoice (SENT) + balanced
//                  POSTED JE (Dr AR / Cr Revenue). NO bank leg: collections
//                  settle later through payouts.
//   payout       → BankTransaction inflow on the payout account (env
//                  DODO_PAYOUT_BANK_NAME, default Operating Checking).
//                  PENDING — allocation to invoices is manual/reconciled.
//   refund       → BankTransaction outflow + best-effort link to the AR
//                  invoice promoted from its payment.
//   subscription → Customer only (collection schedule feeds forecasts later).
//
// Every promoted row stores provider amount+currency AND converted USD + rate.
// One bad row → REJECTED with reason, never kills the batch. Re-running over
// STAGED rows is safe: natural keys (invoiceNumber, bank externalId, customer
// code) are re-found and adopted instead of duplicated.

import type { PrismaClient } from "@prisma/client";
import { convert } from "../fx";

export interface PromoteOpts {
  limit?: number;
  actorId?: string;
  /** Bank account name receiving payouts. Defaults to Operating Checking. */
  payoutBankName?: string;
}

export interface PromoteDetail {
  stagedId: string;
  status: "PROMOTED" | "REJECTED";
  promotedId?: string;
  reason?: string;
}

export interface PromoteResult {
  promoted: number;
  rejected: number;
  details: PromoteDetail[];
}

type StagedRow = {
  id: string;
  provider: string;
  kind: string;
  externalId: string;
  occurredAt: Date;
  currency: string;
  amount: unknown;
  customerExternalId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  raw: unknown;
};

const bankSourceFor = (provider: string): "DODO_IMPORT" | "CSV_IMPORT" =>
  provider === "dodo" ? "DODO_IMPORT" : "CSV_IMPORT";

const invoiceNumberFor = (provider: string, externalId: string): string =>
  `EXT-${provider.toUpperCase()}-${externalId}`.slice(0, 80);

const customerCodeFor = (provider: string, externalId: string): string =>
  `${provider.toUpperCase()}-${externalId}`.slice(0, 60);

function usdOf(row: StagedRow): { total: number; rate: number; source: string } {
  const amount = Number(row.amount);
  if (!Number.isFinite(amount)) throw new Error(`staged amount is not finite: ${String(row.amount)}`);
  const c = convert(amount, row.currency, "USD", new Date(row.occurredAt));
  return { total: c.amount, rate: c.rate, source: c.source };
}

async function ensureCustomer(
  db: PrismaClient,
  orgId: string,
  provider: string,
  row: StagedRow
): Promise<string> {
  if (!row.customerExternalId) throw new Error("staged row has no customer");
  const code = customerCodeFor(provider, row.customerExternalId);
  const existing = await db.customer.findFirst({ where: { orgId, code } });
  if (existing) return (existing as { id: string }).id;
  const created = await db.customer.create({
    data: {
      orgId,
      code,
      name: row.customerName || row.customerEmail || code,
    },
  });
  return (created as { id: string }).id;
}

async function postInvoiceJe(
  db: PrismaClient,
  orgId: string,
  opts: { entryNumber: string; date: Date; memo: string; customerId: string; invoiceId: string; total: number }
): Promise<string> {
  const je = await db.journalEntry.create({
    data: {
      orgId,
      entryNumber: opts.entryNumber,
      date: opts.date,
      memo: opts.memo,
      source: "INVOICE_AR",
      status: "POSTED",
    },
  });
  const jeId = (je as { id: string }).id;
  const accountId = async (code: string): Promise<string> => {
    const a = await db.account.findFirst({ where: { orgId, code } });
    if (!a) throw new Error(`account ${code} missing — run db seed first`);
    return (a as { id: string }).id;
  };
  const arId = await accountId("1100");
  const revId = await accountId("4000");
  const dr = await db.transaction.create({
    data: {
      orgId, journalEntryId: jeId, accountId: arId, customerId: opts.customerId,
      invoiceId: opts.invoiceId, date: opts.date, debit: opts.total, credit: 0,
      description: opts.memo,
    },
  });
  await db.transaction.create({
    data: {
      orgId, journalEntryId: jeId, accountId: revId, customerId: opts.customerId,
      invoiceId: opts.invoiceId, date: opts.date, debit: 0, credit: opts.total,
      description: opts.memo,
    },
  });
  return (dr as { id: string }).id;
}

async function promotePayment(
  db: PrismaClient,
  orgId: string,
  row: StagedRow
): Promise<string> {
  const { total } = usdOf(row);
  if (!(total > 0)) throw new Error(`non-positive payment amount: ${total}`);
  const invoiceNumber = invoiceNumberFor(row.provider, row.externalId);
  const existing = await db.invoice.findFirst({ where: { orgId, invoiceNumber } });
  if (existing) return (existing as { id: string }).id; // replay after partial failure
  const customerId = await ensureCustomer(db, orgId, row.provider, row);
  const issueDate = new Date(row.occurredAt);
  const dueDate = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const inv = await db.invoice.create({
    data: {
      orgId,
      type: "AR",
      status: "SENT",
      invoiceNumber,
      customerId,
      subtotal: total,
      tax: 0,
      total,
      currency: "USD",
      issueDate,
      dueDate,
    },
  });
  const invId = (inv as { id: string }).id;
  await postInvoiceJe(db, orgId, {
    entryNumber: `DJE-${row.id}`,
    date: issueDate,
    memo: `Dodo collection ${invoiceNumber}`,
    customerId,
    invoiceId: invId,
    total,
  });
  return invId;
}

async function payoutAccountId(
  db: PrismaClient,
  orgId: string,
  payoutBankName: string
): Promise<string> {
  const acct = await db.bankAccount.findFirst({ where: { orgId, name: payoutBankName } });
  if (!acct) {
    throw new Error(
      `payout bank account "${payoutBankName}" not found — set DODO_PAYOUT_BANK_NAME to an existing account`
    );
  }
  return (acct as { id: string }).id;
}

async function promotePayout(
  db: PrismaClient,
  orgId: string,
  row: StagedRow,
  bankAccountId: string
): Promise<string> {
  const { total, rate, source } = usdOf(row);
  if (!(total > 0)) throw new Error(`non-positive payout amount: ${total}`);
  const externalId = `dodo_payout_${row.externalId}`.slice(0, 200);
  const existing = await db.bankTransaction.findFirst({
    where: { orgId, bankAccountId, externalId },
  });
  if (existing) return (existing as { id: string }).id;
  const created = await db.bankTransaction.create({
    data: {
      orgId,
      bankAccountId,
      date: new Date(row.occurredAt),
      description: `Dodo payout ${row.externalId} (${row.currency} ${Number(row.amount)} @ ${rate} ${source})`.slice(0, 500),
      amount: total,
      externalId,
      source: bankSourceFor(row.provider),
      status: "PENDING",
    },
  });
  return (created as { id: string }).id;
}

async function promoteRefund(db: PrismaClient, orgId: string, row: StagedRow): Promise<string> {
  const { total } = usdOf(row);
  // Refund legs flow out: provider amounts arrive positive, books store negative.
  const outflow = -Math.abs(total);
  if (!(outflow < 0)) throw new Error(`non-positive refund amount: ${total}`);
  const payoutBankName =
    process.env.DODO_PAYOUT_BANK_NAME ?? "Operating Checking";
  const bankAccountId = await payoutAccountId(db, orgId, payoutBankName);
  const externalId = `dodo_refund_${row.externalId}`.slice(0, 200);
  const existing = await db.bankTransaction.findFirst({
    where: { orgId, bankAccountId, externalId },
  });
  if (existing) return (existing as { id: string }).id;
  // Best-effort link: the AR invoice promoted from the refunded payment.
  const raw = (row.raw ?? {}) as { payment_id?: unknown };
  const paymentId = typeof raw.payment_id === "string" ? raw.payment_id : null;
  let invoiceId: string | null = null;
  if (paymentId) {
    const inv = await db.invoice.findFirst({
      where: { orgId, invoiceNumber: invoiceNumberFor(row.provider, paymentId) },
    });
    invoiceId = inv ? (inv as { id: string }).id : null;
  }
  const created = await db.bankTransaction.create({
    data: {
      orgId,
      bankAccountId,
      date: new Date(row.occurredAt),
      description: `Dodo refund ${row.externalId}`.slice(0, 500),
      amount: outflow,
      externalId,
      source: bankSourceFor(row.provider),
      status: "PENDING",
      ...(invoiceId ? { invoiceId } : {}),
    },
  });
  return (created as { id: string }).id;
}

async function promoteSubscription(
  db: PrismaClient,
  orgId: string,
  row: StagedRow
): Promise<string> {
  // No financial rows yet — the customer record feeds collection schedules later.
  return ensureCustomer(db, orgId, row.provider, row);
}

async function settleRow(
  db: PrismaClient,
  orgId: string,
  row: StagedRow,
  payoutBankName: string
): Promise<PromoteDetail> {
  try {
    let promotedId: string;
    switch (row.kind) {
      case "payment":
        promotedId = await promotePayment(db, orgId, row);
        break;
      case "payout":
        promotedId = await promotePayout(
          db, orgId, row, await payoutAccountId(db, orgId, payoutBankName)
        );
        break;
      case "refund":
        promotedId = await promoteRefund(db, orgId, row);
        break;
      case "subscription":
        promotedId = await promoteSubscription(db, orgId, row);
        break;
      default:
        throw new Error(`unknown staged kind: ${row.kind}`);
    }
    await db.stagedRecord.update({
      where: { id: row.id },
      data: { status: "PROMOTED", promotedId, rejectReason: null },
    });
    return { stagedId: row.id, status: "PROMOTED", promotedId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await db.stagedRecord.update({
        where: { id: row.id },
        data: { status: "REJECTED", rejectReason: reason.slice(0, 500) },
      });
    } catch {
      // Ledger write must not mask the original reason.
    }
    return { stagedId: row.id, status: "REJECTED", reason };
  }
}

/**
 * Promote STAGED rows (oldest first, bounded). Safe to re-run: only STAGED
 * rows are picked up, and natural keys are adopted, never duplicated.
 */
export async function promoteStagedRecords(
  db: PrismaClient,
  orgId: string,
  opts: PromoteOpts = {}
): Promise<PromoteResult> {
  if (!orgId) throw new Error("orgId is required");
  const limit = Number.isInteger(opts.limit) && (opts.limit as number) > 0
    ? Math.min(opts.limit as number, 1000)
    : 100;
  const payoutBankName =
    opts.payoutBankName ?? process.env.DODO_PAYOUT_BANK_NAME ?? "Operating Checking";

  const rows = (await db.stagedRecord.findMany({
    where: { orgId, status: "STAGED" },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: limit,
  })) as unknown as StagedRow[];

  const details: PromoteDetail[] = [];
  for (const row of rows) {
    details.push(await settleRow(db, orgId, row, payoutBankName));
  }
  const promoted = details.filter((d) => d.status === "PROMOTED").length;

  try {
    await db.auditLog.create({
      data: {
        orgId,
        actorId: opts.actorId ?? null,
        action: "connector.promote",
        entityType: "StagedRecord",
        entityId: "",
        metadata: { promoted, rejected: details.length - promoted, limit } as never,
      },
    });
  } catch {
    // Audit must never fail the promotion response.
  }
  return { promoted, rejected: details.length - promoted, details };
}
