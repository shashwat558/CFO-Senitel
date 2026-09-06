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

export const MONTHLY_OPEX = { payroll: 145000, rent: 28000, utilitiesBase: 6500 };
export const MONTHLY_REVENUE_BASE = 1200000;
export const MONTHLY_REVENUE_GROWTH = 5000; // +$5k per month index
