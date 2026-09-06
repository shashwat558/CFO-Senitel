// Foreign exchange — dated, deterministic conversion for connector data.
//
// The books stay single-currency (USD); every promoted external row stores
// both the provider amount+currency AND the converted USD figure plus the
// rate used, so any number traces back to its FX assumption. Rates are a
// static dated snapshot (documented source below) — swapping in a live feed
// later means replacing lookupRate(), never touching callers or tools.

export const FX_SOURCE = "RBI-SNAPSHOT-2024";

/** Monthly USD→INR reference (INR per 1 USD), index 0 = January. */
const USDINR_2024 = [83.0, 82.9, 82.8, 83.3, 83.3, 83.4, 83.6, 83.9, 83.8, 84.0, 84.4, 84.6];

/** Flat 2024 reference rates to USD for the other supported currencies. */
const TO_USD_FLAT: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
};

export const FX_CURRENCIES = ["USD", "INR", "EUR", "GBP"] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

export function isSupportedCurrency(code: string): boolean {
  return (FX_CURRENCIES as readonly string[]).includes(code.toUpperCase());
}

function monthIndex(at: Date): number {
  return at.getUTCMonth();
}

/** Units of `currency` per 1 USD at date `at`. Throws on unknown currency. */
export function lookupRate(currency: string, at: Date): { perUsd: number; source: string } {
  const code = currency.toUpperCase();
  if (code === "USD") return { perUsd: 1, source: FX_SOURCE };
  if (code === "INR") {
    const y = at.getUTCFullYear();
    const perUsd = y === 2024 ? USDINR_2024[monthIndex(at)] : USDINR_2024[USDINR_2024.length - 1];
    return { perUsd, source: FX_SOURCE };
  }
  const flat = TO_USD_FLAT[code];
  if (flat === undefined) {
    throw new Error(`unsupported currency for FX: ${currency}`);
  }
  return { perUsd: 1 / flat, source: `${FX_SOURCE}-FLAT` };
}

export interface Conversion {
  amount: number; // major units in `to`, rounded to 2dp
  from: string;
  to: string;
  rate: number; // multiply `from` major units by `rate` → `to`
  source: string;
  at: string;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) throw new Error(`FX produced a non-finite amount: ${String(n)}`);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Convert major-unit `amount` from one supported currency to another. */
export function convert(amount: number, from: string, to: string, at: Date): Conversion {
  if (!Number.isFinite(amount)) throw new Error(`FX amount must be finite: ${String(amount)}`);
  if (Number.isNaN(at.getTime())) throw new Error("FX requires a valid date");
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) {
    return { amount: round2(amount), from: f, to: t, rate: 1, source: FX_SOURCE, at: at.toISOString() };
  }
  const fromRate = lookupRate(f, at); // units of `from` per 1 USD
  const toRate = lookupRate(t, at); // units of `to` per 1 USD
  // amount → USD → target: out = amount × (toPerUsd / fromPerUsd).
  const rate = toRate.perUsd / fromRate.perUsd;
  return {
    amount: round2(amount * rate),
    from: f,
    to: t,
    rate,
    source: `${fromRate.source}+${toRate.source}`,
    at: at.toISOString(),
  };
}
