// Dated FX conversion (pure): same amount/date/currencies → same result.

import { describe, expect, it } from "vitest";
import { convert, isSupportedCurrency, lookupRate } from "../lib/fx";

const AUG = new Date("2024-08-11T00:00:00.000Z");

describe("fx", () => {
  it("converts INR to USD with the August 2024 snapshot rate", () => {
    const c = convert(3590.4, "INR", "USD", AUG);
    expect(c.rate).toBeCloseTo(1 / 83.9, 6);
    expect(c.amount).toBeCloseTo(42.8, 1);
    expect(c.from).toBe("INR");
    expect(c.to).toBe("USD");
    expect(c.source).toContain("RBI-SNAPSHOT-2024");
  });

  it("is identity within a currency and inverts across months", () => {
    expect(convert(100, "USD", "USD", AUG).amount).toBe(100);
    const jan = convert(8300, "INR", "USD", new Date("2024-01-15T00:00:00.000Z"));
    expect(jan.amount).toBe(100); // 8300 / 83.0
    const back = convert(jan.amount, "USD", "INR", new Date("2024-01-15T00:00:00.000Z"));
    expect(back.amount).toBe(8300);
  });

  it("rejects unknown currencies and bad inputs loudly", () => {
    expect(() => convert(10, "XXX", "USD", AUG)).toThrow(/unsupported currency/);
    expect(() => convert(Number.NaN, "INR", "USD", AUG)).toThrow(/finite/);
    expect(() => convert(10, "INR", "USD", new Date("nope"))).toThrow(/valid date/);
    expect(() => lookupRate("XXX", AUG)).toThrow(/unsupported currency/);
  });

  it("gates supported currencies", () => {
    expect(isSupportedCurrency("inr")).toBe(true);
    expect(isSupportedCurrency("XXX")).toBe(false);
  });
});
