import { describe, expect, it } from "vitest";
import {
  calculateFinancialImpact,
  calculateGrossMargin,
  calculateGrossProfit,
  calculateVariance,
  calculateVariancePercent,
  calculateVendorContribution,
} from "../lib/financial/calculations";

describe("financial calculations (deterministic, pure)", () => {
  it("gross profit = revenue − cogs", () => {
    expect(calculateGrossProfit(1_200_000, 726_000)).toBe(474_000);
    expect(calculateGrossProfit(0, 0)).toBe(0);
  });

  it("gross margin is a 0–100 percent, 0 when revenue is 0", () => {
    expect(calculateGrossMargin(1_200_000, 726_000)).toBeCloseTo(39.5, 1);
    expect(calculateGrossMargin(0, 500)).toBe(0);
    expect(calculateGrossMargin(100, 100)).toBe(0);
  });

  it("variance and variance percent", () => {
    expect(calculateVariance(32.2, 39.5)).toBeCloseTo(-7.3, 1);
    expect(calculateVariancePercent(110, 100)).toBe(10);
    expect(calculateVariancePercent(90, 100)).toBe(-10);
    // Deterministic guard: no Infinity leaking into JSON APIs.
    expect(calculateVariancePercent(50, 0)).toBe(0);
    expect(calculateVariancePercent(0, 0)).toBe(0);
  });

  it("vendor contribution is share of total, 0 when total is 0", () => {
    expect(calculateVendorContribution(280_500, 726_000)).toBeCloseTo(38.64, 1);
    expect(calculateVendorContribution(0, 0)).toBe(0);
  });

  it("financial impact quantifies a price deviation", () => {
    const impact = calculateFinancialImpact({
      baselineUnitPrice: 850,
      actualUnitPrice: 1088,
      quantity: 330,
    });
    expect(impact.unitVariance).toBe(238);
    expect(impact.unitVariancePercent).toBe(28);
    expect(impact.totalImpact).toBe(78_540);
    expect(impact.baselineCost).toBe(280_500);
    expect(impact.actualCost).toBe(359_040);
  });

  it("rejects non-finite and negative inputs loudly (never silently wrong)", () => {
    expect(() => calculateGrossProfit(NaN, 1)).toThrow();
    expect(() => calculateGrossMargin(Infinity, 1)).toThrow();
    expect(() =>
      calculateFinancialImpact({ baselineUnitPrice: -1, actualUnitPrice: 5, quantity: 1 })
    ).toThrow();
    expect(() =>
      calculateFinancialImpact({ baselineUnitPrice: 1, actualUnitPrice: 5, quantity: -2 })
    ).toThrow();
  });
});
