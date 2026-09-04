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
  return min + rng() * (max - min);
}

/** Rounded to 2dp. */
export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Integer in [min, max] inclusive. */
export function int(rng: Rng, min: number, max: number): number {
  return Math.floor(range(rng, min, max + 1));
}
