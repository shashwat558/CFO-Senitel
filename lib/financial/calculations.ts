// CFO Sentinel — deterministic financial calculations.
//
// ARCHITECTURAL RULE: these functions are pure, synchronous, and have zero
// LLM / network / DB access. The agent may CALL them (via tools), but the
// LLM must NEVER be responsible for authoritative financial math.
// All currency math rounds to 2 decimal places (cents).

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function assertFinite(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

/** Gross profit = revenue − COGS. */
export function calculateGrossProfit(revenue: number, cogs: number): number {
  assertFinite("revenue", revenue);
  assertFinite("cogs", cogs);
  return round2(revenue - cogs);
}

/**
 * Gross margin as a percentage in 0–100 (e.g. 40.25 means 40.25%).
 * Returns 0 when revenue is 0 (no division by zero, no NaN leaking).
 */
export function calculateGrossMargin(revenue: number, cogs: number): number {
  assertFinite("revenue", revenue);
  assertFinite("cogs", cogs);
  if (revenue === 0) return 0;
  return round2(((revenue - cogs) / revenue) * 100);
}

/** Absolute variance: current − previous. */
export function calculateVariance(current: number, previous: number): number {
  assertFinite("current", current);
  assertFinite("previous", previous);
  return round2(current - previous);
}

/**
 * Variance percent relative to `previous`: ((current − previous) / |previous|) * 100.
 * Returns 0 when previous is 0 and current is 0; returns +Infinity-sign-safe
 * `current > 0 ? 100 : current < 0 ? -100 : 0`... Actually we return 0 when
 * previous === 0 to stay deterministic and avoid Infinity in JSON/APIs.
 * Callers needing "new expense from zero" semantics should check `previous === 0`
 * explicitly. Documented here so behavior is never surprising.
 */
export function calculateVariancePercent(current: number, previous: number): number {
  assertFinite("current", current);
  assertFinite("previous", previous);
  if (previous === 0) return 0;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

/** Vendor's share of total spend as a percentage in 0–100. 0 when total is 0. */
export function calculateVendorContribution(
  vendorSpend: number,
  totalSpend: number
): number {
  assertFinite("vendorSpend", vendorSpend);
  assertFinite("totalSpend", totalSpend);
  if (totalSpend === 0) return 0;
  return round2((vendorSpend / totalSpend) * 100);
}

export interface FinancialImpactInput {
  /** Contracted / baseline unit price. */
  baselineUnitPrice: number;
  /** Actually invoiced unit price. */
  actualUnitPrice: number;
  /** Billed quantity in the same unit of measure. */
  quantity: number;
}

export interface FinancialImpact {
  unitVariance: number;
  unitVariancePercent: number;
  /** Total overcharge (or saving if negative): unitVariance × quantity. */
  totalImpact: number;
  baselineCost: number;
  actualCost: number;
}

/**
 * Evidence-backed impact of a price deviation:
 * e.g. contract $100/ton vs invoiced $128/ton × 500 tons = $14,000 impact.
 * Throws on negative prices/quantities — data errors must surface, never hide.
 */
export function calculateFinancialImpact(input: FinancialImpactInput): FinancialImpact {
  const { baselineUnitPrice, actualUnitPrice, quantity } = input;
  assertFinite("baselineUnitPrice", baselineUnitPrice);
  assertFinite("actualUnitPrice", actualUnitPrice);
  assertFinite("quantity", quantity);
  if (baselineUnitPrice < 0 || actualUnitPrice < 0) {
    throw new Error("unit prices must be >= 0");
  }
  if (quantity < 0) throw new Error("quantity must be >= 0");

  const unitVariance = round2(actualUnitPrice - baselineUnitPrice);
  const unitVariancePercent =
    baselineUnitPrice === 0 ? 0 : round2((unitVariance / baselineUnitPrice) * 100);
  return {
    unitVariance,
    unitVariancePercent,
    totalImpact: round2(unitVariance * quantity),
    baselineCost: round2(baselineUnitPrice * quantity),
    actualCost: round2(actualUnitPrice * quantity),
  };
}
