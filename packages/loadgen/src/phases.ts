/**
 * The traffic sampler — pure. Given a phase and a seeded RNG it plans intents with real
 * variation: rate, size (log-normal, capped), fee ceiling (weighted buckets, some deliberately
 * below the vaults' tiers), clusters and whales. Scarcity is never scheduled here; it emerges
 * when this traffic meets finite capital and minutes-long canonical settlement.
 */
import type { LoadgenConfig, PhaseConfig, PhaseKind } from './config.js';
import { between, intBetween, logNormal, weightedIndex, type Rng } from './rng.js';

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

    if (rng.next() < phase.largeIntentProbability) {
      intents.push({
        at: t,
        sourceChainId,
        destinationChainId,
        amount: usdc(Math.round(between(rng, phase.largeAmountRange.min, phase.largeAmountRange.max))),
        maxFeeBps: sampleFee(phase, rng),
        deadlineSeconds,
        phase: phase.kind,
        tag: 'whale',
      });
      continue;
    }

    if (rng.next() < phase.clusterProbability) {
      const size = intBetween(rng, phase.clusterSize.min, phase.clusterSize.max);
      for (let i = 0; i < size; i++) {
        intents.push({
          at: t + intBetween(rng, 0, 30),
          sourceChainId,
          destinationChainId,
          amount: sampleAmount(phase, rng),
          maxFeeBps: sampleFee(phase, rng),
          deadlineSeconds,
          phase: phase.kind,
          tag: 'cluster',
        });
      }
      continue;
    }

    intents.push({
      at: t,
      sourceChainId,
      destinationChainId,
      amount: sampleAmount(phase, rng),
      maxFeeBps: sampleFee(phase, rng),
      deadlineSeconds,
      phase: phase.kind,
      tag: 'regular',
    });
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
