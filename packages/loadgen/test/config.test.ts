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

describe('the committed default profile is the demo cadence', () => {
  it('averages an arrival every four to six minutes before clusters and the controller, and cannot be driven above 1.5x', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const raw = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'loadgen.config.json'), 'utf8'));
    const config = parseLoadgenConfig(raw);
    const weights = config.phaseWeights;
    const perHour = config.phases.map((p) => ((p.intentsPerMinuteRange.min + p.intentsPerMinuteRange.max) / 2) * 60);
    const weighted = perHour.reduce((acc, r, i) => acc + r * weights[i]!, 0) / weights.reduce((a, b) => a + b, 0);
    // ~11 arrivals an hour before intentsPerFire; at three per arrival that is ~34 intents an
    // hour, and at a median ~210 USDC it carries roughly half the market's 3,240 USDC of vault
    // capital as live exposure — high utilisation bought with fewer, larger transactions rather
    // than more of them, because gas is the running cost (2026-09-15).
    expect(weighted).toBeGreaterThan(8);
    expect(weighted).toBeLessThan(18);
    expect(config.scarcity.weightMultiplierBounds.max).toBeLessThanOrEqual(1.5);
    expect(config.phases.find((p) => p.kind === 'background')!.intentsPerMinuteRange.max).toBeLessThanOrEqual(0.3);
    // WP-34: about one in seven intents names a token out — trades are 1-8 USDC against 40 USDC
    // pools, so a larger share would drag the average intent size (and utilisation) down.
    expect(config.tradeIntentShare).toBeCloseTo(0.15, 2);
  });
});
