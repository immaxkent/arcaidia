/**
 * The scarcity controller — open loop, no coordination, and deliberately weak.
 *
 * It never switches anything off. It measures how much of a rolling window the ecosystem
 * spent *constrained* (no vault could fill a typical intent) and nudges the phase-selection
 * weight multipliers toward the target, within configured bounds. Scarcity still has to
 * emerge from traffic meeting finite capital and minutes-long settlement; this only keeps
 * the traffic from being so light that it never happens, or so heavy that it always does.
 */
import type { ScarcityControllerConfig } from './config.js';

export interface ScarcitySample {
  readonly at: number;
  readonly constrained: boolean;
}

/** Fraction of the trailing `windowSeconds` that was constrained, by time-weighting samples. */
export function constrainedFraction(samples: readonly ScarcitySample[], now: number, windowSeconds: number): number | null {
  const from = now - windowSeconds;
  const inWindow = samples.filter((s) => s.at >= from && s.at <= now).sort((a, b) => a.at - b.at);
  if (inWindow.length < 2) return null;
  let constrainedSeconds = 0;
  let total = 0;
  for (let i = 1; i < inWindow.length; i++) {
    const dt = inWindow[i]!.at - inWindow[i - 1]!.at;
    total += dt;
    if (inWindow[i - 1]!.constrained) constrainedSeconds += dt;
  }
  return total === 0 ? null : constrainedSeconds / total;
}

/**
 * Phase-kind multipliers: heavier phases (`burst`, `whale`, `cluster`) get scaled by `m`,
 * lighter ones (`background`, `tight-fee`) by `1/m`, so the *mix* shifts while every kind
 * still occurs. `m` moves by `gain * (target - observed)` per step and is clamped.
 */
export function nextMultiplier(current: number, observed: number | null, config: ScarcityControllerConfig): number {
  if (observed === null) return current;
  const proposed = current + config.gain * (config.target - observed);
  return Math.min(config.weightMultiplierBounds.max, Math.max(config.weightMultiplierBounds.min, proposed));
}

const HEAVY = new Set(['burst', 'whale', 'cluster']);

export function applyMultiplier(baseWeights: readonly number[], kinds: readonly string[], multiplier: number): number[] {
  return baseWeights.map((w, i) => (HEAVY.has(kinds[i] ?? '') ? w * multiplier : w / multiplier));
}
