import { describe, expect, it } from 'vitest';
import { applyMultiplier, constrainedFraction, nextMultiplier } from '../src/index.js';
import { defaultConfig } from './fixtures.js';

const scarcity = defaultConfig().scarcity;

describe('scarcity controller', () => {
  it('measures the constrained fraction by time, not by sample count', () => {
    const samples = [
      { at: 0, constrained: true },
      { at: 600, constrained: false },
      { at: 3000, constrained: true },
      { at: 3600, constrained: false },
    ];
    expect(constrainedFraction(samples, 3600, 3600)).toBeCloseTo(1200 / 3600, 5);
    expect(constrainedFraction(samples.slice(0, 1), 3600, 3600)).toBeNull();
  });

  it('nudges toward the target and never leaves the configured bounds', () => {
    let m = 1;
    for (let i = 0; i < 100; i++) m = nextMultiplier(m, 0, scarcity);
    expect(m).toBe(scarcity.weightMultiplierBounds.max);
    for (let i = 0; i < 100; i++) m = nextMultiplier(m, 1, scarcity);
    expect(m).toBe(scarcity.weightMultiplierBounds.min);
    expect(nextMultiplier(1.3, null, scarcity)).toBe(1.3);
    expect(nextMultiplier(1, scarcity.target, scarcity)).toBe(1);
  });

  it('shifts the mix but keeps every phase kind possible', () => {
    const heavier = applyMultiplier([5, 3, 1, 2, 2], ['background', 'burst', 'whale', 'cluster', 'tight-fee'], 2);
    expect(heavier).toEqual([2.5, 6, 2, 4, 1]);
    expect(heavier.every((w) => w > 0)).toBe(true);
  });
});
