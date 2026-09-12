/**
 * Seeded randomness, so a traffic plan is reproducible: the same seed and config always
 * produce the same schedule, which is what makes the sampler unit-testable and a demo run
 * re-playable. mulberry32 — small, fast, good enough for scheduling; never used for keys.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Uniform integer in [min, max] inclusive. */
export function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}

/** Uniform real in [min, max). */
export function between(rng: Rng, min: number, max: number): number {
  return min + rng.next() * (max - min);
}

/** Standard normal via Box–Muller. */
export function gaussian(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng.next();
  while (v === 0) v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal draw with the given parameters of the underlying normal. */
export function logNormal(rng: Rng, mu: number, sigma: number): number {
  return Math.exp(mu + sigma * gaussian(rng));
}

/** Pick an index by weight. Weights need not sum to one. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return 0;
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]!);
    if (r < 0) return i;
  }
  return weights.length - 1;
}
