import { describe, expect, it } from 'vitest';
import { mulberry32, planPhase, planSchedule, usdc } from '../src/index.js';
import { defaultConfig } from './fixtures.js';

const config = defaultConfig();
const phase = (kind: string) => config.phases.find((p) => p.kind === kind)!;

describe('planPhase', () => {
  it('is deterministic under a seed', () => {
    const a = planPhase(config, phase('burst'), 1_000, mulberry32(7));
    const b = planPhase(config, phase('burst'), 1_000, mulberry32(7));
    expect(a).toEqual(b);
    expect(planPhase(config, phase('burst'), 1_000, mulberry32(8))).not.toEqual(a);
  });

  it('keeps every intent inside the phase window, sorted, with amounts within the caps', () => {
    const p = planPhase(config, phase('background'), 5_000, mulberry32(1));
    expect(p.endsAt - p.startsAt).toBeGreaterThanOrEqual(300);
    for (let i = 0; i < p.intents.length; i++) {
      const it = p.intents[i]!;
      expect(it.at).toBeGreaterThanOrEqual(p.startsAt);
      expect(it.at).toBeLessThan(p.endsAt + 31); // clusters may spill up to 30 s
      if (i > 0) expect(it.at).toBeGreaterThanOrEqual(p.intents[i - 1]!.at);
      if (it.tag !== 'whale') {
        expect(it.amount).toBeGreaterThanOrEqual(usdc(1));
        expect(it.amount).toBeLessThanOrEqual(usdc(15));
      }
      expect(it.deadlineSeconds).toBeGreaterThanOrEqual(1800);
    }
  });

  it('a burst produces more intents per minute than background', () => {
    let background = 0, burst = 0, bgMinutes = 0, burstMinutes = 0;
    for (let seed = 0; seed < 20; seed++) {
      const b = planPhase(config, phase('background'), 0, mulberry32(seed));
      const u = planPhase(config, phase('burst'), 0, mulberry32(seed + 100));
      background += b.intents.length; bgMinutes += (b.endsAt - b.startsAt) / 60;
      burst += u.intents.length; burstMinutes += (u.endsAt - u.startsAt) / 60;
    }
    expect(burst / burstMinutes).toBeGreaterThan((background / bgMinutes) * 2);
  });

  it('the whale phase is all large intents; the cluster phase is mostly clusters', () => {
    const w = planPhase(config, phase('whale'), 0, mulberry32(3));
    expect(w.intents.length).toBeGreaterThan(0);
    expect(w.intents.every((i) => i.tag === 'whale' && i.amount >= usdc(25))).toBe(true);
    const cl = planPhase(config, phase('cluster'), 0, mulberry32(4));
    expect(cl.intents.filter((i) => i.tag === 'cluster').length / cl.intents.length).toBeGreaterThan(0.6);
  });

  it('the tight-fee phase deliberately sets ceilings below every vault tier (organic declines)', () => {
    const t = planPhase(config, phase('tight-fee'), 0, mulberry32(5));
    expect(t.intents.length).toBeGreaterThan(0);
    expect(t.intents.every((i) => i.maxFeeBps <= 20)).toBe(true);
  });

  it('honours the direction share', () => {
    const p = planPhase(config, { ...phase('burst'), durationRange: { min: 3600, max: 3600 } }, 0, mulberry32(9));
    const toArc = p.intents.filter((i) => i.sourceChainId === 11155111).length / p.intents.length;
    expect(toArc).toBeGreaterThan(0.35);
    expect(toArc).toBeLessThan(0.65);
  });
});

describe('planSchedule', () => {
  it('covers the span with contiguous phases, varied kinds, and no off window', () => {
    const phases = planSchedule(config, config.phaseWeights, 0, 2 * 3600, mulberry32(42));
    expect(phases.length).toBeGreaterThan(3);
    for (let i = 1; i < phases.length; i++) expect(phases[i]!.startsAt).toBe(phases[i - 1]!.endsAt);
    expect(phases[phases.length - 1]!.endsAt).toBeGreaterThanOrEqual(2 * 3600);
    expect(new Set(phases.map((p) => p.kind)).size).toBeGreaterThanOrEqual(3);
  });
});
