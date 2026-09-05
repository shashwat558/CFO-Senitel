// Deterministic PRNG (mulberry32). Repeated seeding produces identical datasets.

export type Rng = () => number;

/** Create a seeded RNG. Same seed → same sequence, forever. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new Error(`range requires finite min <= max, got ${min}, ${max}`);
  }
  return min + rng() * (max - min);
}

/** Rounded to 2dp. Throws on non-finite (same contract as round2). */
export function money(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`money expects a finite number, got ${String(n)}`);
  }
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Integer in [min, max] inclusive. */
export function int(rng: Rng, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new Error(`int requires integer min <= max, got ${min}, ${max}`);
  }
  if (max - min + 1 > Number.MAX_SAFE_INTEGER) {
    throw new Error(`int range too large: ${min}..${max}`);
  }
  return Math.floor(range(rng, min, max + 1));
}
