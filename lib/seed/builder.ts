// Deterministic Acme Industries dataset builder.
// PURE: no DB, no network, no randomness beyond the seeded RNG.
// `buildDataset()` always returns the identical dataset for the same constants.
// prisma/seed.ts persists the result; tests assert integrity without a database.

import { createRng, range, money, type Rng } from "./rng";
import {
  SEED,
  SEED_YEAR,
  ORG,
  USERS,
  VENDORS,
  CUSTOMERS,
  ACCOUNTS,
  INCIDENT,
  MONTHLY_OPEX,
  MONTHLY_REVENUE_BASE,
  MONTHLY_REVENUE_GROWTH,
} from "./constants";

export interface SeedDataset {
  organization: { id: string; name: string; slug: string };
  users: Array<{ id: string; email: string; name: string; role: string }>;
  vendors: Array<{ id: string; code: string; name: string; category: string }>;
  customers: Array<{ id: string; code: string; name: string; segment: string; region: string }>;
  accounts: Array<{ id: string; code: string; name: string; type: string }>;
  contracts: ContractRow[];
  purchaseOrders: PurchaseOrderRow[];
  invoices: InvoiceRow[];
  journalEntries: JournalEntryRow[];
  transactions: TransactionRow[];
  incident: IncidentRow;
}

export interface ContractRow {
  id: string; vendorCode: string; contractNumber: string; title: string;
  material: string; unitOfMeasure: string; unitPrice: number; quantity: number;
  totalValue: number; status: string; startDate: Date; endDate: Date;
}

export interface PurchaseOrderRow {
  id: string; vendorCode: string; contractNumber: string | null; poNumber: string;
  material: string; quantity: number; unitPrice: number; subtotal: number;
  tax: number; total: number; orderDate: Date; expectedDate: Date;
}

export interface InvoiceRow {
  id: string; type: "AP" | "AR"; status: string; invoiceNumber: string;
  vendorCode: string | null; customerCode: string | null;
  contractNumber: string | null; poNumber: string | null;
  material: string | null; quantity: number | null; unitPrice: number | null;
  subtotal: number; tax: number; total: number; issueDate: Date; dueDate: Date;
}

export interface JournalEntryRow {
  id: string; entryNumber: string; date: Date; memo: string; source: string;
}

export interface TransactionRow {
  id: string; entryNumber: string; accountCode: string;
  vendorCode: string | null; customerCode: string | null;
  invoiceNumber: string | null; date: Date; debit: number; credit: number;
  description: string;
}

export interface IncidentRow {
  id: string; title: string; description: string; type: string;
  status: string; severity: string; periodStart: Date; periodEnd: Date;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
// UTC-safe day arithmetic (avoids DST pitfalls of +86400000 on local dates).
const addDays = (d: Date, n: number) => {
  const copy = new Date(d.getTime());
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
};

export function buildDataset(seed = SEED): SeedDataset {
  const rng: Rng = createRng(seed);
  const year = SEED_YEAR;

  const contracts: ContractRow[] = VENDORS.map((v) => {
    const annualQty = money(v.baseQtyPerMonth * 12);
    return {
      id: `contract_${v.code.toLowerCase()}`,
      vendorCode: v.code,
      contractNumber: `CTR-${year}-${v.code}`,
      title: `${v.name} — ${v.material} supply ${year}`,
      material: v.material,
      unitOfMeasure: v.unitOfMeasure,
      unitPrice: v.contractUnitPrice,
      quantity: annualQty,
      totalValue: money(v.contractUnitPrice * annualQty),
      status: "ACTIVE",
      startDate: utc(year, 1, 1),
      endDate: utc(year, 12, 31),
    };
  });

  const purchaseOrders: PurchaseOrderRow[] = [];
  const invoices: InvoiceRow[] = [];
  const journalEntries: JournalEntryRow[] = [];
  const transactions: TransactionRow[] = [];
  let jeSeq = 0;
  let txSeq = 0;

  const nextJe = (date: Date, memo: string, source: string): JournalEntryRow => {
    jeSeq += 1;
    const entryNumber = `JE-${String(jeSeq).padStart(6, "0")}`;
    const je = { id: `je_${String(jeSeq).padStart(6, "0")}`, entryNumber, date, memo, source };
    journalEntries.push(je);
    return je;
  };
  const addLine = (
    je: JournalEntryRow, accountCode: string, debit: number, credit: number,
    opts: { vendorCode?: string | null; customerCode?: string | null; invoiceNumber?: string | null; description?: string; date?: Date } = {}
  ) => {
    txSeq += 1;
    transactions.push({
      id: `tx_${String(txSeq).padStart(6, "0")}`,
      entryNumber: je.entryNumber,
      accountCode,
      vendorCode: opts.vendorCode ?? null,
      customerCode: opts.customerCode ?? null,
      invoiceNumber: opts.invoiceNumber ?? null,
      date: opts.date ?? je.date,
      debit: money(debit),
      credit: money(credit),
      description: opts.description ?? je.memo,
    });
  };

  for (let m = 1; m <= 12; m++) {
    const mm = `${year}${pad2(m)}`;

    // ---- Procure-to-pay: one PO + one AP invoice per vendor per month ----
    VENDORS.forEach((v, vi) => {
      const isIncidentMonth = m === INCIDENT.month && v.code === INCIDENT.vendorCode;
      // Flat baseline: mean-reverting ±3% noise with NO cumulative trend, so the
      // August price spike reads as a sharp V (dip + recovery), not a drift.
      // UNIT-measured materials (brackets, harnesses) must stay whole units;
      // TON/KG/SHIPMENT materials may be fractional.
      const rawQty = v.baseQtyPerMonth * (1 + range(rng, -0.03, 0.03));
      const qty = v.unitOfMeasure === "UNIT" ? Math.max(1, Math.round(rawQty)) : money(rawQty);
      const baseNoise = 1 + range(rng, -0.015, 0.015);
      const unitPrice = money(
        isIncidentMonth
          ? v.contractUnitPrice * INCIDENT.priceMultiplier * (1 + range(rng, -0.005, 0.005))
          : v.contractUnitPrice * baseNoise
      );
      const subtotal = money(qty * unitPrice);
      const orderDate = utc(year, m, 8 + (vi % 4));
      const poNumber = `PO-${mm}-${v.code}-01`;
      const invNumber = `AP-${mm}-${v.code}-01`;
      purchaseOrders.push({
        id: `po_${mm}_${v.code.toLowerCase()}`,
        vendorCode: v.code,
        contractNumber: `CTR-${year}-${v.code}`,
        poNumber,
        material: v.material,
        quantity: qty,
        unitPrice,
        subtotal,
        tax: 0,
        total: subtotal,
        orderDate,
        expectedDate: addDays(orderDate, 7),
      });
      const issueDate = addDays(orderDate, 3);
      invoices.push({
        id: `inv_ap_${mm}_${v.code.toLowerCase()}`,
        type: "AP",
        status: issueDate < utc(year, 10, 1) ? "PAID" : "SENT",
        invoiceNumber: invNumber,
        vendorCode: v.code,
        customerCode: null,
        contractNumber: `CTR-${year}-${v.code}`,
        poNumber,
        material: v.material,
        quantity: qty,
        unitPrice,
        subtotal,
        tax: 0,
        total: subtotal,
        issueDate,
        dueDate: addDays(issueDate, 30),
      });
      // GL: Dr COGS / Cr AP (double-entry, balanced by construction)
      const je = nextJe(issueDate, `AP ${invNumber} — ${v.name}`, "INVOICE_AP");
      addLine(je, v.cogsAccountCode, subtotal, 0, { vendorCode: v.code, invoiceNumber: invNumber });
      addLine(je, "2000", 0, subtotal, { vendorCode: v.code, invoiceNumber: invNumber });
    });

    // ---- Order-to-cash: 2 AR invoices per customer (10/month) ----
    const softness = m === INCIDENT.month ? 0.985 : 1;
    const monthlyTarget = money(
      (MONTHLY_REVENUE_BASE + MONTHLY_REVENUE_GROWTH * (m - 1)) * softness *
        (1 + range(rng, -0.01, 0.01))
    );
    CUSTOMERS.forEach((c, ci) => {
      const custTarget = money(monthlyTarget * c.share * (1 + range(rng, -0.04, 0.04)));
      const splits: Array<[string, number]> = [
        [`AR-${mm}-${c.code}-01`, 0.6],
        [`AR-${mm}-${c.code}-02`, 0.4],
      ];
      splits.forEach(([invNumber, frac], si) => {
        const total = money(custTarget * frac);
        const day = Math.min(28, 5 + ci * 2 + si * 9 + Math.floor(range(rng, 0, 2)));
        const issueDate = utc(year, m, day);
        invoices.push({
          id: `inv_ar_${mm}_${c.code.toLowerCase()}_0${si + 1}`,
          type: "AR",
          status: issueDate < utc(year, 10, 1) ? "PAID" : "SENT",
          invoiceNumber: invNumber,
          vendorCode: null,
          customerCode: c.code,
          contractNumber: null,
          poNumber: null,
          material: null,
          quantity: null,
          unitPrice: null,
          subtotal: total,
          tax: 0,
          total,
          issueDate,
          dueDate: addDays(issueDate, 30),
        });
        // GL: Dr AR / Cr Revenue
        const je = nextJe(issueDate, `AR ${invNumber} — ${c.name}`, "INVOICE_AR");
        addLine(je, "1100", total, 0, { customerCode: c.code, invoiceNumber: invNumber });
        addLine(je, "4000", 0, total, { customerCode: c.code, invoiceNumber: invNumber });
      });
    });

    // ---- Monthly opex (payroll / rent / utilities) ----
    const opexDate = utc(year, m, 28);
    const utilities = money(MONTHLY_OPEX.utilitiesBase * (1 + range(rng, -0.08, 0.08)));
    const opexLines = [
      { acct: "6000", amt: MONTHLY_OPEX.payroll, memo: `Payroll ${mm}`, source: "PAYROLL" },
      { acct: "6010", amt: MONTHLY_OPEX.rent, memo: `Rent ${mm}`, source: "MANUAL" },
      { acct: "6020", amt: utilities, memo: `Utilities ${mm}`, source: "MANUAL" },
    ];
    for (const l of opexLines) {
      const je = nextJe(opexDate, l.memo, l.source);
      addLine(je, l.acct, l.amt, 0, { description: l.memo });
      addLine(je, "1000", 0, l.amt, { description: l.memo });
    }
  }

  return {
    organization: { id: ORG.id, name: ORG.name, slug: ORG.slug },
    users: USERS.map((u) => ({ ...u })),
    vendors: VENDORS.map((v, i) => ({
      id: `vendor_${v.code.toLowerCase()}`, code: v.code, name: v.name, category: v.category,
    })),
    customers: CUSTOMERS.map((c) => ({
      id: `customer_${c.code.toLowerCase()}`, code: c.code, name: c.name,
      segment: c.segment ?? "MANUFACTURING", region: c.region ?? "US-MIDWEST",
    })),
    accounts: ACCOUNTS.map((a) => ({ id: `acct_${a.code}`, ...a })),
    contracts,
    purchaseOrders,
    invoices,
    journalEntries,
    transactions,
    incident: {
      id: "incident_gm_aug2024",
      title: "Gross margin decline — August 2024",
      description:
        "Gross margin fell in August 2024 vs July 2024. Open for investigation: break down P&L, vendor spend, and contract-vs-invoice prices.",
      type: "GROSS_MARGIN_DECLINE",
      status: "OPEN",
      severity: "HIGH",
      periodStart: utc(INCIDENT.year, INCIDENT.month, 1),
      periodEnd:
        INCIDENT.month >= 12
          ? utc(INCIDENT.year + 1, 1, 1)
          : utc(INCIDENT.year, INCIDENT.month + 1, 1),
    },
  };
}
