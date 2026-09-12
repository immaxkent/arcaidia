import { describe, expect, it } from 'vitest';
import { LoadgenConfigError, parseLoadgenConfig } from '../src/index.js';
import { defaultConfig } from './fixtures.js';

type Raw = Record<string, unknown>;
const withPhase0 = (c: Raw, patch: object): Raw => ({ ...c, phases: [{ ...((c.phases as object[])[0] as object), ...patch }], phaseWeights: [1] });

describe('parseLoadgenConfig', () => {
  it('accepts the committed default profile', () => {
    const config = defaultConfig();
    expect(config.phases.map((p) => p.kind)).toEqual(['background', 'burst', 'whale', 'cluster', 'tight-fee']);
    expect(config.scarcity.target).toBe(0.2);
  });

  it.each([
    ['a non-integer seed', (c: Raw) => ({ ...c, seed: 1.5 }), /seed/],
    ['a share outside [0,1]', (c: Raw) => ({ ...c, ethereumToArcShare: 1.2 }), /ethereumToArcShare/],
    ['mismatched phase weights', (c: Raw) => ({ ...c, phaseWeights: [1] }), /phaseWeights/],
    ['an unknown phase kind', (c: Raw) => withPhase0(c, { kind: 'nap' }), /kind/],
    ['a fee bucket above 100%', (c: Raw) => withPhase0(c, { maxFeeBps: [{ maxFeeBps: 10_001, weight: 1 }] }), /maxFeeBps/],
    ['an inverted range', (c: Raw) => withPhase0(c, { durationRange: { min: 9, max: 1 } }), /durationRange/],
    ['controller bounds below zero', (c: Raw) => ({ ...c, scarcity: { ...(c.scarcity as object), weightMultiplierBounds: { min: -1, max: 2 } } }), /weightMultiplierBounds/],
  ])('rejects %s, naming the field', (_label, mutate, pattern) => {
    const raw = mutate(JSON.parse(JSON.stringify(defaultConfig())) as Raw);
    expect(() => parseLoadgenConfig(raw)).toThrow(LoadgenConfigError);
    expect(() => parseLoadgenConfig(raw)).toThrow(pattern);
  });
});

describe('the committed default profile is calm', () => {
  it('averages about two transfers an hour before clusters and the controller, and cannot be driven above 1.5x', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const raw = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'loadgen.config.json'), 'utf8'));
    const config = parseLoadgenConfig(raw);
    const weights = config.phaseWeights;
    const perHour = config.phases.map((p) => ((p.intentsPerMinuteRange.min + p.intentsPerMinuteRange.max) / 2) * 60);
    const weighted = perHour.reduce((acc, r, i) => acc + r * weights[i]!, 0) / weights.reduce((a, b) => a + b, 0);
    expect(weighted).toBeGreaterThan(1);
    expect(weighted).toBeLessThan(4);
    expect(config.scarcity.weightMultiplierBounds.max).toBeLessThanOrEqual(1.5);
    expect(config.phases.find((p) => p.kind === 'background')!.intentsPerMinuteRange.max).toBeLessThanOrEqual(0.05);
  });
});
