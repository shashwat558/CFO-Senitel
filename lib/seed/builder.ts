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
  BANK_ACCOUNTS,
  PAYROLL_FUNDING_DAY,
  FORECAST_METRICS,
  CASH_CRISIS,
  LEAKAGE,
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
  bankAccounts: BankAccountRow[];
  bankTransactions: BankTransactionRow[];
  budgets: BudgetRow[];
  forecasts: ForecastRow[];
  incidents: IncidentRow[];
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

export interface BankAccountRow {
  id: string; code: string; name: string; currency: string; openingBalance: number;
}

export interface BankTransactionRow {
  id: string; bankCode: string; date: Date; description: string;
  amount: number; externalId: string; source: string; status: string;
  invoiceNumber: string | null; glTransactionId: string | null;
}

export interface BudgetRow {
  id: string; accountCode: string; year: number; month: number; amount: number;
}

export interface ForecastRow {
  id: string; metric: string; year: number; month: number; amount: number; scenario: string;
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
  // Booked utilities per month (index m-1) — reused by the bank legs so the
  // bank mirrors the GL exactly without consuming extra RNG.
  const monthlyUtilities: number[] = [];
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
  ): TransactionRow => {
    txSeq += 1;
    const row: TransactionRow = {
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
    };
    transactions.push(row);
    return row;
  };
  // Principal (debit-side) GL line per invoice — bank settlement legs link here.
  const principalTxByInvoice = new Map<string, string>();

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
      const dr = addLine(je, v.cogsAccountCode, subtotal, 0, { vendorCode: v.code, invoiceNumber: invNumber });
      addLine(je, "2000", 0, subtotal, { vendorCode: v.code, invoiceNumber: invNumber });
      principalTxByInvoice.set(invNumber, dr.id);
    });

    // ---- Order-to-cash: 2 AR invoices per customer (10/month) ----
    const softness = m === INCIDENT.month ? 0.985 : 1;
    const monthlyTarget = money(
      (MONTHLY_REVENUE_BASE + MONTHLY_REVENUE_GROWTH * (m - 1)) * softness *
        (1 + range(rng, -0.01, 0.01))
    );
    CUSTOMERS.forEach((c, ci) => {
      const custTarget = money(monthlyTarget * c.share * (1 + range(rng, -0.04, 0.04)));
      // Leakage pair: LAKESIDE November ships only split -01 (the -02 is never
      // billed); NORTHSTAR December re-splits 0.4 into 0.2+0.2 at the same
      // total (legitimate timing change, not leakage).
      const splits: Array<[string, number]> =
        m === LEAKAGE.legitMonth && c.code === LEAKAGE.legitCustomerCode
          ? [
              [`AR-${mm}-${c.code}-01`, 0.6],
              [`AR-${mm}-${c.code}-02`, 0.2],
              [`AR-${mm}-${c.code}-03`, 0.2],
            ]
          : [
              [`AR-${mm}-${c.code}-01`, 0.6],
              [`AR-${mm}-${c.code}-02`, 0.4],
            ];
      splits.forEach(([invNumber, frac], si) => {
        if (m === LEAKAGE.missingMonth && c.code === LEAKAGE.missingCustomerCode && si === 1) {
          return; // second split never billed
        }
        const total = money(custTarget * frac);
        const day = Math.min(28, 5 + ci * 2 + si * 9 + Math.floor(range(rng, 0, 2)));
        const issueDate = utc(year, m, day);
        // Cash-crisis pair: H2 AUTOFAB invoices go OVERDUE (payment stop)
        // instead of settling on schedule, and ALL September AR stalls
        // (worsening aging into year-end).
        const overdue =
          (CASH_CRISIS.overdueMonths.includes(m) && c.code === CASH_CRISIS.overdueCustomerCode) ||
          (m === 9 && c.code !== CASH_CRISIS.overdueCustomerCode);
        invoices.push({
          id: `inv_ar_${mm}_${c.code.toLowerCase()}_0${si + 1}`,
          type: "AR",
          status: overdue ? "OVERDUE" : issueDate < utc(year, 10, 1) ? "PAID" : "SENT",
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
        const dr = addLine(je, "1100", total, 0, { customerCode: c.code, invoiceNumber: invNumber });
        addLine(je, "4000", 0, total, { customerCode: c.code, invoiceNumber: invNumber });
        principalTxByInvoice.set(invNumber, dr.id);
      });
    });

    // ---- Monthly opex (payroll / rent / utilities) ----
    const opexDate = utc(year, m, 28);
    const utilities = money(MONTHLY_OPEX.utilitiesBase * (1 + range(rng, -0.08, 0.08)));
    monthlyUtilities.push(utilities);
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

  // ---- Year-end inventory build (cash-crisis commitment): one extra December
  // AP invoice + matching PO for GLC at exactly contract price — no pricing
  // anomaly, pure timing. SENT, due 2025-01-15, inside the 13-week window.
  // NOTE: no RNG consumed — the stream above must stay byte-identical.
  {
    const v = VENDORS.find((x) => x.code === CASH_CRISIS.bulkVendorCode)!;
    const mm = `${year}${pad2(CASH_CRISIS.bulkMonth)}`;
    const qty = CASH_CRISIS.bulkQty;
    const unitPrice = CASH_CRISIS.bulkUnitPrice;
    const subtotal = money(qty * unitPrice);
    const poNumber = `PO-${mm}-${v.code}-02`;
    const invNumber = `AP-${mm}-${v.code}-02`;
    const orderDate = utc(year, CASH_CRISIS.bulkMonth, 18);
    const issueDate = utc(year, CASH_CRISIS.bulkMonth, 20);
    purchaseOrders.push({
      id: `po_${mm}_${v.code.toLowerCase()}_02`,
      vendorCode: v.code,
      contractNumber: `CTR-${year}-${v.code}`,
      poNumber,
      material: CASH_CRISIS.bulkMaterial,
      quantity: qty,
      unitPrice,
      subtotal,
      tax: 0,
      total: subtotal,
      orderDate,
      expectedDate: addDays(orderDate, 7),
    });
    invoices.push({
      id: `inv_ap_${mm}_${v.code.toLowerCase()}_02`,
      type: "AP",
      status: "SENT",
      invoiceNumber: invNumber,
      vendorCode: v.code,
      customerCode: null,
      contractNumber: `CTR-${year}-${v.code}`,
      poNumber,
      material: CASH_CRISIS.bulkMaterial,
      quantity: qty,
      unitPrice,
      subtotal,
      tax: 0,
      total: subtotal,
      issueDate,
      dueDate: new Date(Date.UTC(year + 1, 0, 15)),
    });
    // GL: Dr COGS / Cr AP (December P&L absorbs it; Jul/Aug demo untouched)
    const je = nextJe(issueDate, `AP ${invNumber} — ${v.name}`, "INVOICE_AP");
    const dr = addLine(je, v.cogsAccountCode, subtotal, 0, { vendorCode: v.code, invoiceNumber: invNumber });
    addLine(je, "2000", 0, subtotal, { vendorCode: v.code, invoiceNumber: invNumber });
    principalTxByInvoice.set(invNumber, dr.id);
  }

  // ---- Settlement: every PAID invoice clears through cash (P&L-neutral:
  // only balance-sheet legs 1000/1100/2000, so aggregatePnl is unaffected) ----
  for (const inv of invoices) {
    if (inv.status !== "PAID" || !inv.dueDate) continue;
    if (inv.type === "AP") {
      const je = nextJe(inv.dueDate, `Settle ${inv.invoiceNumber} — ${inv.vendorCode}`, "MANUAL");
      addLine(je, "2000", inv.total, 0, { vendorCode: inv.vendorCode, invoiceNumber: inv.invoiceNumber });
      addLine(je, "1000", 0, inv.total, { vendorCode: inv.vendorCode, invoiceNumber: inv.invoiceNumber });
    } else {
      const je = nextJe(inv.dueDate, `Collect ${inv.invoiceNumber} — ${inv.customerCode}`, "MANUAL");
      addLine(je, "1000", inv.total, 0, { customerCode: inv.customerCode, invoiceNumber: inv.invoiceNumber });
      addLine(je, "1100", 0, inv.total, { customerCode: inv.customerCode, invoiceNumber: inv.invoiceNumber });
    }
  }

  // ---- Bank legs: 1:1 mirror of settlement (amounts match invoice totals
  // EXACTLY — no noise — so reconciliation is meaningful). Legs settling
  // before September are RECONCILED; August/September legs stay PENDING, which
  // is the demo surface for getBankTransactions/reconcileBankTransaction
  // (the unpaid-at-close August Apex leg is a payment-hold candidate).
  // NOTE: no RNG consumed below — the dataset above must stay byte-identical.
  const bankAccounts: BankAccountRow[] = BANK_ACCOUNTS.map((b) => ({
    id: `bank_${b.code.toLowerCase()}`,
    code: b.code,
    name: b.name,
    currency: "USD",
    openingBalance: money(b.openingBalance),
  }));
  const bankTransactions: BankTransactionRow[] = [];
  let btSeq = 0;
  const nextBt = (
    bankCode: string, date: Date, description: string, amount: number,
    opts: { externalId: string; invoiceNumber?: string | null; reconciled: boolean }
  ) => {
    btSeq += 1;
    bankTransactions.push({
      id: `bt_${String(btSeq).padStart(6, "0")}`,
      bankCode,
      date,
      description,
      amount: money(amount),
      externalId: opts.externalId,
      source: "MANUAL",
      status: opts.reconciled ? "RECONCILED" : "PENDING",
      invoiceNumber: opts.invoiceNumber ?? null,
      glTransactionId:
        (opts.invoiceNumber ? principalTxByInvoice.get(opts.invoiceNumber) : undefined) ?? null,
    });
  };
  const settledBeforeSep = (d: Date) => d < utc(year, 9, 1);
  for (const inv of invoices) {
    if (inv.status !== "PAID" || !inv.dueDate) continue;
    const reconciled = settledBeforeSep(inv.dueDate);
    if (inv.type === "AP") {
      nextBt("OPERATING", inv.dueDate, `Vendor payment ${inv.invoiceNumber}`, -inv.total, {
        externalId: `EXT-${inv.invoiceNumber}`,
        invoiceNumber: inv.invoiceNumber,
        reconciled,
      });
    } else {
      nextBt("OPERATING", inv.dueDate, `Customer collection ${inv.invoiceNumber}`, inv.total, {
        externalId: `EXT-${inv.invoiceNumber}`,
        invoiceNumber: inv.invoiceNumber,
        reconciled,
      });
    }
  }
  // Opex rent/utilities leave operating; payroll is funded via transfer.
  for (let m = 1; m <= 12; m++) {
    const mm = `${year}${pad2(m)}`;
    const opexDate = utc(year, m, 28);
    const reconciled = settledBeforeSep(opexDate);
    nextBt("OPERATING", opexDate, `Rent ${mm}`, -MONTHLY_OPEX.rent, {
      externalId: `OPEX-${mm}-RENT`, reconciled,
    });
    nextBt("OPERATING", opexDate, `Utilities ${mm}`, -monthlyUtilities[m - 1], {
      externalId: `OPEX-${mm}-UTIL`, reconciled,
    });
    const fundingDate = utc(year, m, PAYROLL_FUNDING_DAY);
    const fundingReconciled = settledBeforeSep(fundingDate);
    nextBt("OPERATING", fundingDate, `Payroll funding ${mm}`, -MONTHLY_OPEX.payroll, {
      externalId: `XFER-${mm}-OP`, reconciled: fundingReconciled,
    });
    nextBt("PAYROLL", fundingDate, `Payroll funding ${mm}`, MONTHLY_OPEX.payroll, {
      externalId: `XFER-${mm}-PY`, reconciled: fundingReconciled,
    });
    nextBt("PAYROLL", opexDate, `Payroll ${mm}`, -MONTHLY_OPEX.payroll, {
      externalId: `PAY-${mm}`, reconciled,
    });
  }

  // ---- Budgets: set at year start from BASE constants (no noise), so actuals
  // vary around them and August blows through COGS. No RNG consumed. ----
  const matBase = money(
    VENDORS.filter((v) => v.cogsAccountCode === "5000")
      .reduce((s, v) => s + v.baseQtyPerMonth * v.contractUnitPrice, 0)
  );
  const freightBase = money(
    VENDORS.filter((v) => v.cogsAccountCode === "5010")
      .reduce((s, v) => s + v.baseQtyPerMonth * v.contractUnitPrice, 0)
  );
  const budgets: BudgetRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = `${year}${pad2(m)}`;
    const lines: Array<[string, number]> = [
      ["4000", MONTHLY_REVENUE_BASE + MONTHLY_REVENUE_GROWTH * (m - 1)],
      ["5000", matBase],
      ["5010", freightBase],
      ["6000", MONTHLY_OPEX.payroll],
      ["6010", MONTHLY_OPEX.rent],
      ["6020", MONTHLY_OPEX.utilitiesBase],
    ];
    for (const [acct, amt] of lines) {
      budgets.push({ id: `bud_${mm}_${acct}`, accountCode: acct, year, month: m, amount: money(amt) });
    }
  }

  // ---- Forecasts: BASE scenario mirrors the budget (revenue/COGS/opex),
  // running through Mar 2025 so the 13-week cash window has forward sales. ----
  const forecasts: ForecastRow[] = [];
  const forecastMonths: Array<[number, number]> = Array.from({ length: 12 }, (_, i) => [year, i + 1]);
  forecastMonths.push([year + 1, 1], [year + 1, 2], [year + 1, 3]);
  for (const [y, m] of forecastMonths) {
    const idx = (y - year) * 12 + (m - 1); // months since Jan 2024
    const mm = `${y}${pad2(m)}`;
    const revenue = money(MONTHLY_REVENUE_BASE + MONTHLY_REVENUE_GROWTH * idx);
    const cogs = money(matBase + freightBase);
    const opex = money(MONTHLY_OPEX.payroll + MONTHLY_OPEX.rent + MONTHLY_OPEX.utilitiesBase);
    const lines: Array<[string, number]> = [
      ["REVENUE", revenue],
      ["COGS", cogs],
      ["OPEX", opex],
    ];
    for (const [metric, amt] of lines) {
      forecasts.push({
        id: `fc_base_${metric.toLowerCase()}_${mm}`,
        metric, year: y, month: m, amount: money(amt), scenario: "BASE",
      });
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
    bankAccounts,
    bankTransactions,
    budgets,
    forecasts,
    /** Three seeded incidents: margin (Aug 2024), cash (Q1 2025), leakage (Nov 2024). */
    incidents: [
      {
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
      {
        id: "incident_cash_q1_2025",
        title: "Projected cash shortfall — Q1 2025",
        description:
          "13-week forecast from 2025-01-01 breaches the minimum cash floor. Open for investigation: delayed AUTOFAB remittance, overdue October balance, and the January inventory commitment.",
        type: "CASH_CRISIS",
        status: "OPEN",
        severity: "CRITICAL",
        periodStart: utc(2025, 1, 1),
        periodEnd: utc(2025, 4, 1),
      },
      {
        id: "incident_leakage_nov2024",
        title: "Potential revenue leakage — November 2024",
        description:
          "November LAKESIDE billings trail the trailing average with a missing split. Open for investigation: unbilled usage vs legitimate timing changes.",
        type: "REVENUE_LEAKAGE",
        status: "OPEN",
        severity: "MEDIUM",
        periodStart: utc(2024, 11, 1),
        periodEnd: utc(2024, 12, 1),
      },
    ],
  };
}
