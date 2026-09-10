import { describe, expect, it } from 'vitest';
import { RandomNonceSource, SequentialNonceSource } from '../src/solver/ports.js';

describe('SequentialNonceSource', () => {
  it('starts at 1 by default and increments', () => {
    const source = new SequentialNonceSource();
    expect(source.next()).toBe(1n);
    expect(source.next()).toBe(2n);
    expect(source.next()).toBe(3n);
  });

  it('honours a custom start', () => {
    const source = new SequentialNonceSource(100n);
    expect(source.next()).toBe(100n);
    expect(source.next()).toBe(101n);
  });

  /// The exact bug found live 2026-09-10: a fresh source after a restart
  /// starts back at 1, colliding with whatever an earlier run already used
  /// onchain. Documented here, not "fixed" here — RandomNonceSource below is
  /// the fix; this process is deliberately kept for local/test use where a
  /// predictable sequence is actually wanted.
  it('is not restart-safe by design — a fresh instance replays the same sequence', () => {
    const firstRun = new SequentialNonceSource();
    expect(firstRun.next()).toBe(1n);

    const afterARestart = new SequentialNonceSource();
    expect(afterARestart.next()).toBe(1n);
  });
});

describe('RandomNonceSource', () => {
  it('returns a bigint', () => {
    expect(typeof new RandomNonceSource().next()).toBe('bigint');
  });

  it('produces different values across calls, including across separate instances', () => {
    const a = new RandomNonceSource();
    const values = new Set<bigint>();
    for (let i = 0; i < 50; i++) values.add(a.next());
    values.add(new RandomNonceSource().next());

    expect(values.size).toBe(51);
  });

  it('stays within uint256 range', () => {
    const source = new RandomNonceSource();
    for (let i = 0; i < 20; i++) {
      const value = source.next();
      expect(value).toBeGreaterThanOrEqual(0n);
      expect(value).toBeLessThan(2n ** 256n);
    }
  });

  /// The actual property that matters: restarting the process (a fresh
  /// instance) does not replay a value an earlier run could plausibly have
  /// already used onchain — unlike SequentialNonceSource above.
  it('is restart-safe: two fresh instances do not collide', () => {
    const beforeRestart = new RandomNonceSource().next();
    const afterRestart = new RandomNonceSource().next();
    expect(beforeRestart).not.toBe(afterRestart);
  });
});
