/**
 * The load generator's configuration — every knob explicit, schema-checked on load, nothing
 * hard-coded in the loop. Amounts are in USDC units (6 decimals) as plain numbers of whole
 * USDC in the file for legibility; the sampler converts to base units.
 */

export type PhaseKind = 'background' | 'burst' | 'whale' | 'cluster' | 'tight-fee';

export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface AmountDistribution {
  /** Log-normal parameters of ln(amount in whole USDC). */
  readonly mu: number;
  readonly sigma: number;
  /** Hard caps in whole USDC. */
  readonly minUsdc: number;
  readonly maxUsdc: number;
}

export interface FeeBucket {
  readonly maxFeeBps: number;
  readonly weight: number;
}

export interface PhaseConfig {
  readonly kind: PhaseKind;
  /** Seconds. */
  readonly durationRange: Range;
  readonly intentsPerMinuteRange: Range;
  readonly amount: AmountDistribution;
  /** Weighted buckets — include deliberately-too-low ceilings for organic declines. */
  readonly maxFeeBps: readonly FeeBucket[];
  /** Probability that an intent is emitted as a cluster of `clusterSize` within ~30 s. */
  readonly clusterProbability: number;
  readonly clusterSize: Range;
  /** Probability that an intent is a single large one drawn from `largeAmountRange`. */
  readonly largeIntentProbability: number;
  readonly largeAmountRange: Range;
  /** Deadline for created intents, seconds. */
  readonly deadlineSecondsRange: Range;
}

export interface ChainWallets {
  readonly chainId: number;
  /** Which of the configured user keys act on this chain (indices into LOADGEN_USER_KEYS). */
  readonly walletIndices: readonly number[];
}

export interface ScarcityControllerConfig {
  /** Target constrained fraction of operating time, 0–1. */
  readonly target: number;
  /** Rolling window over which the constrained fraction is measured, seconds. */
  readonly windowSeconds: number;
  /** Phase-weight multipliers may drift only within these bounds. */
  readonly weightMultiplierBounds: Range;
  /** How strongly one observation moves the multiplier. */
  readonly gain: number;
  /**
   * "Constrained" means aggregate available fast liquidity is below this fraction of the
   * median intent size — nobody could fill a typical intent right now.
   */
  readonly constrainedIfLiquidityBelowMedianIntentFraction: number;
}

export interface LoadgenConfig {
  readonly seed: number;
  /** Share of intents Ethereum→Arc; the rest Arc→Ethereum. */
  readonly ethereumToArcShare: number;
  readonly chains: readonly ChainWallets[];
  readonly phases: readonly PhaseConfig[];
  /** Selection weight per phase kind, same order as `phases`. */
  readonly phaseWeights: readonly number[];
  readonly scarcity: ScarcityControllerConfig;
  /** Trade intents (WP-34) — kept at 0 until Line 1 lands. */
  readonly tradeIntentShare: number;
  readonly journalPath: string;
  readonly metricsPath: string;
}

export class LoadgenConfigError extends Error {}

function assertRange(name: string, r: Range, lo = -Infinity, hi = Infinity): void {
  if (!(Number.isFinite(r.min) && Number.isFinite(r.max))) throw new LoadgenConfigError(`${name}: min/max must be finite`);
  if (r.min > r.max) throw new LoadgenConfigError(`${name}: min ${r.min} > max ${r.max}`);
  if (r.min < lo || r.max > hi) throw new LoadgenConfigError(`${name}: must lie within [${lo}, ${hi}]`);
}

function assertUnit(name: string, v: number): void {
  if (!(Number.isFinite(v) && v >= 0 && v <= 1)) throw new LoadgenConfigError(`${name}: must be in [0, 1]`);
}

/** Validate a parsed JSON object. Throws `LoadgenConfigError` naming the first offending field. */
export function parseLoadgenConfig(raw: unknown): LoadgenConfig {
  const c = raw as LoadgenConfig;
  if (!c || typeof c !== 'object') throw new LoadgenConfigError('config must be an object');
  if (!Number.isInteger(c.seed)) throw new LoadgenConfigError('seed: integer required');
  assertUnit('ethereumToArcShare', c.ethereumToArcShare);
  assertUnit('tradeIntentShare', c.tradeIntentShare);
  if (!Array.isArray(c.chains) || c.chains.length !== 2) throw new LoadgenConfigError('chains: exactly two entries');
  for (const ch of c.chains) {
    if (!Number.isInteger(ch.chainId)) throw new LoadgenConfigError('chains[].chainId: integer required');
    if (!Array.isArray(ch.walletIndices) || ch.walletIndices.length === 0) throw new LoadgenConfigError(`chains[${ch.chainId}].walletIndices: at least one`);
  }
  if (!Array.isArray(c.phases) || c.phases.length === 0) throw new LoadgenConfigError('phases: at least one');
  if (!Array.isArray(c.phaseWeights) || c.phaseWeights.length !== c.phases.length) throw new LoadgenConfigError('phaseWeights: one per phase');
  const kinds: PhaseKind[] = ['background', 'burst', 'whale', 'cluster', 'tight-fee'];
  c.phases.forEach((p, i) => {
    const n = `phases[${i}]`;
    if (!kinds.includes(p.kind)) throw new LoadgenConfigError(`${n}.kind: one of ${kinds.join('|')}`);
    assertRange(`${n}.durationRange`, p.durationRange, 1);
    assertRange(`${n}.intentsPerMinuteRange`, p.intentsPerMinuteRange, 0);
    if (!(p.amount.sigma >= 0) || !Number.isFinite(p.amount.mu)) throw new LoadgenConfigError(`${n}.amount: mu finite, sigma >= 0`);
    if (!(p.amount.minUsdc > 0 && p.amount.maxUsdc >= p.amount.minUsdc)) throw new LoadgenConfigError(`${n}.amount: 0 < minUsdc <= maxUsdc`);
    if (!Array.isArray(p.maxFeeBps) || p.maxFeeBps.length === 0) throw new LoadgenConfigError(`${n}.maxFeeBps: at least one bucket`);
    for (const b of p.maxFeeBps) {
      if (!(Number.isInteger(b.maxFeeBps) && b.maxFeeBps >= 0 && b.maxFeeBps <= 10_000)) throw new LoadgenConfigError(`${n}.maxFeeBps[].maxFeeBps: 0..10000`);
      if (!(b.weight >= 0)) throw new LoadgenConfigError(`${n}.maxFeeBps[].weight: >= 0`);
    }
    assertUnit(`${n}.clusterProbability`, p.clusterProbability);
    assertRange(`${n}.clusterSize`, p.clusterSize, 1);
    assertUnit(`${n}.largeIntentProbability`, p.largeIntentProbability);
    assertRange(`${n}.largeAmountRange`, p.largeAmountRange, 0);
    assertRange(`${n}.deadlineSecondsRange`, p.deadlineSecondsRange, 60);
  });
  assertUnit('scarcity.target', c.scarcity.target);
  if (!(c.scarcity.windowSeconds > 0)) throw new LoadgenConfigError('scarcity.windowSeconds: > 0');
  assertRange('scarcity.weightMultiplierBounds', c.scarcity.weightMultiplierBounds, 0);
  if (!(c.scarcity.gain >= 0)) throw new LoadgenConfigError('scarcity.gain: >= 0');
  assertUnit('scarcity.constrainedIfLiquidityBelowMedianIntentFraction', c.scarcity.constrainedIfLiquidityBelowMedianIntentFraction);
  if (typeof c.journalPath !== 'string' || typeof c.metricsPath !== 'string') throw new LoadgenConfigError('journalPath/metricsPath: strings');
  return c;
}
