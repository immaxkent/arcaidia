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
