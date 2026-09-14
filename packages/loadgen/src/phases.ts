/**
 * The traffic sampler — pure. Given a phase and a seeded RNG it plans intents with real
 * variation: rate, size (log-normal, capped), fee ceiling (weighted buckets, some deliberately
 * below the vaults' tiers), clusters and whales. Scarcity is never scheduled here; it emerges
 * when this traffic meets finite capital and minutes-long canonical settlement.
 */
import { SWAP_INFRASTRUCTURE, type Address } from '@arcaidia/domain';
import type { LoadgenConfig, PhaseConfig, PhaseKind } from './config.js';
import { between, intBetween, logNormal, weightedIndex, type Rng } from './rng.js';

/** WP-34: a trade intent's terms, decided at planning time; the floor is quoted at submit time. */
export interface PlannedTrade {
  readonly tokenOut: Address;
  readonly symbol: string;
  readonly decimals: number;
  /** One in five trade intents asks for more than the market can give, so the USDC fallback is exercised on purpose. */
  readonly unsatisfiable: boolean;
}

/** The pools hold ~40 USDC each; a trade of this size moves the price a few percent, not half. */
const TRADE_AMOUNT_RANGE_USDC = { min: 1, max: 8 } as const;
const UNSATISFIABLE_TRADE_SHARE = 0.2;

export function marketsOn(destinationChainId: number) {
  for (const infra of Object.values(SWAP_INFRASTRUCTURE)) {
    if (infra && infra.chainId === destinationChainId) return infra.markets;
  }
  return [];
}

/** With probability `tradeIntentShare`, and only where the destination has a market, name a token out. */
export function sampleTrade(config: LoadgenConfig, destinationChainId: number, rng: Rng): PlannedTrade | undefined {
  if (config.tradeIntentShare <= 0) return undefined;
  const markets = marketsOn(destinationChainId);
  if (markets.length === 0) return undefined;
  if (rng.next() >= config.tradeIntentShare) return undefined;
  const market = markets[intBetween(rng, 0, markets.length - 1)]!;
  return {
    tokenOut: market.tokenOut.address,
    symbol: market.tokenOut.symbol,
    decimals: market.tokenOut.decimals,
    unsatisfiable: rng.next() < UNSATISFIABLE_TRADE_SHARE,
  };
}

export interface PlannedIntent {
  /** Unix seconds at which to submit. */
  readonly at: number;
  readonly sourceChainId: number;
  readonly destinationChainId: number;
  /** Base units (6 decimals). */
  readonly amount: bigint;
  readonly maxFeeBps: number;
  readonly deadlineSeconds: number;
  readonly phase: PhaseKind;
  readonly tag: 'regular' | 'cluster' | 'whale';
  /** WP-34: present on a trade intent (non-USDC token out); absent on a plain transfer. */
  readonly trade?: PlannedTrade;
}

export interface PlannedPhase {
  readonly kind: PhaseKind;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly intents: readonly PlannedIntent[];
}

const USDC = 1_000_000n;

export function usdc(whole: number): bigint {
  return BigInt(Math.round(whole * 1_000_000));
}

function sampleAmount(phase: PhaseConfig, rng: Rng): bigint {
  const whole = logNormal(rng, phase.amount.mu, phase.amount.sigma);
  const capped = Math.min(phase.amount.maxUsdc, Math.max(phase.amount.minUsdc, whole));
  return usdc(Math.round(capped * 100) / 100);
}

function sampleTradeAmount(rng: Rng): bigint {
  return usdc(Math.round(between(rng, TRADE_AMOUNT_RANGE_USDC.min, TRADE_AMOUNT_RANGE_USDC.max) * 100) / 100);
}

function sampleFee(phase: PhaseConfig, rng: Rng): number {
  const idx = weightedIndex(rng, phase.maxFeeBps.map((b) => b.weight));
  return phase.maxFeeBps[idx]!.maxFeeBps;
}

function sampleDirection(config: LoadgenConfig, rng: Rng): [number, number] {
  const [a, b] = config.chains;
  const ethereumFirst = a!.chainId === 11155111 ? [a!.chainId, b!.chainId] : [b!.chainId, a!.chainId];
  return rng.next() < config.ethereumToArcShare
    ? [ethereumFirst[0]!, ethereumFirst[1]!]
    : [ethereumFirst[1]!, ethereumFirst[0]!];
}

/** Which phase runs next, by (possibly controller-adjusted) weights. */
export function samplePhaseIndex(config: LoadgenConfig, weights: readonly number[], rng: Rng): number {
  return weightedIndex(rng, weights);
}

/** Plan one phase starting at `startsAt`. Deterministic for a given RNG state. */
export function planPhase(config: LoadgenConfig, phase: PhaseConfig, startsAt: number, rng: Rng): PlannedPhase {
  const duration = intBetween(rng, phase.durationRange.min, phase.durationRange.max);
  const perMinute = between(rng, phase.intentsPerMinuteRange.min, phase.intentsPerMinuteRange.max);
  const endsAt = startsAt + duration;
  const intents: PlannedIntent[] = [];

  if (perMinute <= 0) return { kind: phase.kind, startsAt, endsAt, intents };

  // Exponential inter-arrival times around the phase rate: a Poisson-ish stream rather than a
  // metronome, so bursts within a phase look like real users, not a cron job.
  let t = startsAt;
  while (true) {
    const gap = -Math.log(1 - rng.next()) * (60 / perMinute);
    t += Math.max(1, Math.round(gap));
    if (t >= endsAt) break;

    const [sourceChainId, destinationChainId] = sampleDirection(config, rng);
    const deadlineSeconds = intBetween(rng, phase.deadlineSecondsRange.min, phase.deadlineSecondsRange.max);

    // Every arrival fires `intentsPerFire` intents, each freshly sampled, a few seconds apart.
    const salvo = (k: number): number => (k === 0 ? t : t + k * intBetween(rng, 3, 15));

    if (rng.next() < phase.largeIntentProbability) {
      for (let k = 0; k < config.intentsPerFire; k++) {
        intents.push({
          at: salvo(k),
          sourceChainId,
          destinationChainId,
          amount: usdc(Math.round(between(rng, phase.largeAmountRange.min, phase.largeAmountRange.max))),
          maxFeeBps: sampleFee(phase, rng),
          deadlineSeconds,
          phase: phase.kind,
          tag: 'whale',
        });
      }
      continue;
    }

    if (rng.next() < phase.clusterProbability) {
      const size = intBetween(rng, phase.clusterSize.min, phase.clusterSize.max);
      for (let i = 0; i < size; i++) {
        const trade = sampleTrade(config, destinationChainId, rng);
        intents.push({
          at: t + intBetween(rng, 0, 30),
          sourceChainId,
          destinationChainId,
          amount: trade ? sampleTradeAmount(rng) : sampleAmount(phase, rng),
          maxFeeBps: sampleFee(phase, rng),
          deadlineSeconds,
          phase: phase.kind,
          tag: 'cluster',
          ...(trade ? { trade } : {}),
        });
      }
      continue;
    }

    for (let k = 0; k < config.intentsPerFire; k++) {
      const trade = sampleTrade(config, destinationChainId, rng);
      intents.push({
        at: salvo(k),
        sourceChainId,
        destinationChainId,
        amount: trade ? sampleTradeAmount(rng) : sampleAmount(phase, rng),
        maxFeeBps: sampleFee(phase, rng),
        deadlineSeconds,
        phase: phase.kind,
        tag: 'regular',
        ...(trade ? { trade } : {}),
      });
    }
  }

  intents.sort((x, y) => x.at - y.at);
  return { kind: phase.kind, startsAt, endsAt, intents };
}

/** A full plan for `totalSeconds` of operation: phases back to back, weights as given. */
export function planSchedule(
  config: LoadgenConfig,
  weights: readonly number[],
  startsAt: number,
  totalSeconds: number,
  rng: Rng,
): PlannedPhase[] {
  const phases: PlannedPhase[] = [];
  let t = startsAt;
  while (t < startsAt + totalSeconds) {
    const phase = config.phases[samplePhaseIndex(config, weights, rng)]!;
    const planned = planPhase(config, phase, t, rng);
    phases.push(planned);
    t = planned.endsAt;
  }
  return phases;
}

export const ONE_USDC = USDC;
