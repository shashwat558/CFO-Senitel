// Acme Industries — canonical deterministic dataset constants.
// Changing these changes the seeded dataset; the August incident parameters
// live here (data), NOT in application logic (never hardcode conclusions).

export const SEED = 42;
export const SEED_YEAR = 2024;
export const ORG = {
  id: "org_acme_industries",
  name: "Acme Industries",
  slug: "acme-industries",
};

export const USERS = [
  { id: "user_maya_chen", email: "maya.chen@acme.example", name: "Maya Chen", role: "CFO" as const },
  { id: "user_david_okafor", email: "david.okafor@acme.example", name: "David Okafor", role: "CONTROLLER" as const },
  { id: "user_priya_nair", email: "priya.nair@acme.example", name: "Priya Nair", role: "VIEWER" as const },
];

/**
 * The org's default user — the v1 session stub (lib/auth/session.ts) resolves
 * to this actor, and session.user.orgId is the tenant every route/service/
 * tool query is scoped to. Migrating the seed org to a default user lets
 * routes stop looking up the org by slug.
 */
export const DEFAULT_USER = USERS[0];

export interface VendorSpec {
  code: string;
  name: string;
  category: string;
  material: string;
  unitOfMeasure: string;
  contractUnitPrice: number;
  baseQtyPerMonth: number;
  cogsAccountCode: string;
}

export const VENDORS: VendorSpec[] = [
  { code: "APEX", name: "Apex Steel Co", category: "RAW_MATERIALS", material: "STEEL_COIL", unitOfMeasure: "TON", contractUnitPrice: 850, baseQtyPerMonth: 330, cogsAccountCode: "5000" },
  { code: "GLC", name: "Great Lakes Components", category: "COMPONENTS", material: "STEEL_BRACKET", unitOfMeasure: "UNIT", contractUnitPrice: 12.5, baseQtyPerMonth: 12000, cogsAccountCode: "5000" },
  { code: "PAC", name: "Pacific Plastics", category: "RAW_MATERIALS", material: "POLYMER_RESIN", unitOfMeasure: "KG", contractUnitPrice: 3.2, baseQtyPerMonth: 40000, cogsAccountCode: "5000" },
  { code: "VOLT", name: "VoltEdge Electronics", category: "COMPONENTS", material: "WIRING_HARNESS", unitOfMeasure: "UNIT", contractUnitPrice: 22, baseQtyPerMonth: 5000, cogsAccountCode: "5000" },
  { code: "MWL", name: "Midwest Logistics", category: "FREIGHT", material: "FREIGHT", unitOfMeasure: "SHIPMENT", contractUnitPrice: 4800, baseQtyPerMonth: 12, cogsAccountCode: "5010" },
];

export interface CustomerSpec {
  code: string;
  name: string;
  share: number; // share of monthly revenue, sums to 1
  segment?: string;
  region?: string;
}

export const CUSTOMERS: CustomerSpec[] = [
  { code: "AUTOFAB", name: "AutoFab Systems", share: 0.28, segment: "MANUFACTURING", region: "US-MIDWEST" },
  { code: "BUILDRIGHT", name: "BuildRight Corp", share: 0.24, segment: "MANUFACTURING", region: "US-MIDWEST" },
  { code: "HEARTLAND", name: "Heartland Appliances", share: 0.2, segment: "MANUFACTURING", region: "US-MIDWEST" },
  { code: "NORTHSTAR", name: "NorthStar Equipment", share: 0.16, segment: "MANUFACTURING", region: "US-MIDWEST" },
  { code: "LAKESIDE", name: "Lakeside Motors", share: 0.12, segment: "MANUFACTURING", region: "US-MIDWEST" },
];

export const ACCOUNTS = [
  { code: "1000", name: "Cash", type: "ASSET" as const },
  { code: "1100", name: "Accounts Receivable", type: "ASSET" as const },
  { code: "1200", name: "Inventory", type: "ASSET" as const },
  { code: "2000", name: "Accounts Payable", type: "LIABILITY" as const },
  { code: "4000", name: "Revenue — Product Sales", type: "REVENUE" as const },
  { code: "5000", name: "COGS — Materials", type: "COGS" as const },
  { code: "5010", name: "COGS — Freight", type: "COGS" as const },
  { code: "6000", name: "Opex — Payroll", type: "EXPENSE" as const },
  { code: "6010", name: "Opex — Rent", type: "EXPENSE" as const },
  { code: "6020", name: "Opex — Utilities", type: "EXPENSE" as const },
];

/** August incident injection (data fact, not a conclusion). */
export const INCIDENT = {
  year: 2024,
  month: 8, // August
  vendorCode: "APEX",
  /** Invoiced unit price multiplier vs contract in the incident month. */
  priceMultiplier: 1.28,
  note: "Unapproved supplier surcharge applied to August Apex Steel invoices",
};

/** Cash-crisis injection (data facts, not conclusions). AUTOFAB — 28% of
 * revenue — stops paying in H2: all twelve Jul–Dec invoices go OVERDUE, so a
 * 13-week forecast from 2025-01-01 shows collections collapsing against firm
 * outflows, including a large year-end inventory build due mid-January. */
export const CASH_CRISIS = {
  overdueCustomerCode: "AUTOFAB",
  overdueMonths: [7, 8, 9, 10, 11, 12], // H2 invoices go OVERDUE (payment stop)
  bulkVendorCode: "GLC",
  bulkMonth: 12,
  bulkMaterial: "STEEL_BRACKET",
  bulkUnitOfMeasure: "UNIT",
  bulkUnitPrice: 12.5, // == contract price: no pricing anomaly, pure timing
  bulkQty: 48000, // $600,000 year-end inventory build, SENT, due 2025-01-15
  note: "Delayed AUTOFAB remittance plus January inventory commitment",
};

/** Revenue-leakage injection (data facts, not conclusions). November LAKESIDE
 * ships only its first split (second never billed → MISSING_INVOICE), while
 * December NORTHSTAR splits 0.4 into 0.2+0.2 at the same total (a legitimate
 * timing/structure change the classifier must NOT flag as leakage). */
export const LEAKAGE = {
  missingCustomerCode: "LAKESIDE",
  missingMonth: 11,
  legitCustomerCode: "NORTHSTAR",
  legitMonth: 12,
  note: "Unbilled LAKESIDE split vs legitimate NORTHSTAR re-split",
};

export const MONTHLY_OPEX = { payroll: 145000, rent: 28000, utilitiesBase: 6500 };
export const MONTHLY_REVENUE_BASE = 1200000;
export const MONTHLY_REVENUE_GROWTH = 5000; // +$5k per month index

// Bank legs mirror settled invoices 1:1 (see builder): collections in,
// payments out, dated at the invoice paidAt. Amounts match invoice totals
// EXACTLY (no noise) so reconciliation is meaningful.
export const BANK_ACCOUNTS = [
  { code: "OPERATING", name: "Operating Checking", openingBalance: 850000 },
  { code: "PAYROLL", name: "Payroll Account", openingBalance: 200000 },
];

/** Day-of-month the operating account funds payroll. */
export const PAYROLL_FUNDING_DAY = 25;

/** Forecast metrics seeded under the BASE scenario. */
export const FORECAST_METRICS = ["REVENUE", "COGS", "OPEX"] as const;
