// CFO Sentinel — deterministic financial calculations.
//
// ARCHITECTURAL RULE: these functions are pure, synchronous, and have zero
// LLM / network / DB access. The agent may CALL them (via tools), but the
// LLM must NEVER be responsible for authoritative financial math.
// All currency math rounds to 2 decimal places (cents).

export function round2(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`round2 expects a finite number, got ${String(n)}`);
  }
  // Symmetric half-up to 2dp: EPSILON nudges binary-float .005 cases over
  // the rounding boundary without biasing negatives.
  const adjusted = n >= 0 ? n + Number.EPSILON : n - Number.EPSILON;
  return Math.round(adjusted * 100) / 100;
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
 * Negative revenue or COGS is mathematically computed but indicates a data
 * problem (credit memos, mis-postings) — callers should treat margins
 * outside 0–100 as a signal to investigate source rows.
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
 * Returns 0 when previous === 0 (both 0→0 and new-from-zero→0) to stay
 * deterministic and avoid Infinity in JSON/APIs. This intentionally masks the
 * "new from zero" signal — callers needing spike detection must check
 * `previous === 0 && current !== 0` explicitly before calling.
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
  if (vendorSpend < 0 || totalSpend < 0) {
    throw new Error("vendorSpend and totalSpend must be >= 0");
  }
  if (totalSpend === 0) return 0;
  // Values >100 indicate a data error (vendorSpend > totalSpend) — returned
  // as-is so reconciliation checks can catch it, never clamped silently.
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

  // Single-rounding invariant: baseline/actual costs are rounded once, and
  // totalImpact is derived from those rounded costs so that
  // totalImpact === actualCost − baselineCost exactly (no qty*0.005 drift).
  const baselineCost = round2(baselineUnitPrice * quantity);
  const actualCost = round2(actualUnitPrice * quantity);
  const unitVariance = round2(actualUnitPrice - baselineUnitPrice);
  const unitVariancePercent =
    baselineUnitPrice === 0 ? 0 : round2((unitVariance / baselineUnitPrice) * 100);
  return {
    unitVariance,
    unitVariancePercent,
    totalImpact: round2(actualCost - baselineCost),
    baselineCost,
    actualCost,
  };
}
