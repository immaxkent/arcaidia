import { describe, expect, it } from 'vitest';
import { formatBps, formatDuration, formatUsdc, shortAddress, usdc } from '../src/format.js';

describe('formatUsdc', () => {
  it('renders whole units with thousands separators', () => {
    expect(formatUsdc(100_000_000_000n)).toBe('100,000.00');
  });

  it('renders sub-unit amounts', () => {
    expect(formatUsdc(500_000n)).toBe('0.50');
    expect(formatUsdc(1n)).toBe('0.00');
  });

  it('renders zero', () => {
    expect(formatUsdc(0n)).toBe('0.00');
  });

  it('renders negatives', () => {
    expect(formatUsdc(-1_500_000n)).toBe('-1.50');
  });

  /// The reason this exists: a tool that returned raw units would leave a
  /// language model to guess the decimals, and it will sometimes guess wrong
  /// inside a sentence that sounds entirely confident.
  it('never loses precision to floating point', () => {
    // Beyond 2^53 — Number would round this.
    expect(formatUsdc(9_007_199_254_740_993_000_000n)).toBe('9,007,199,254,740,993.00');
  });

  it('truncates rather than rounds the displayed fraction', () => {
    // 1.239999 displays as 1.23, never 1.24 — an overstated balance is worse
    // than an understated one.
    expect(formatUsdc(1_239_999n)).toBe('1.23');
  });

  it('attaches the unit for prose', () => {
    expect(usdc(1_000_000n)).toBe('1.00 USDC');
  });
});

describe('formatBps', () => {
  it.each([
    [0, '0.00%'],
    [10, '0.10%'],
    [2_500, '25.00%'],
    [10_000, '100.00%'],
  ])('renders %i bps as %s', (bps, expected) => {
    expect(formatBps(bps)).toBe(expected);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [45, '45s'],
    [90, '1m 30s'],
    [4_500, '1h 15m'],
  ])('renders %i seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  /// Null means "not observed". Rendering it as 0s would report a fact the
  /// system does not have.
  it('keeps null as null rather than reporting zero', () => {
    expect(formatDuration(null)).toBeNull();
  });
});

describe('shortAddress', () => {
  it('truncates a full address', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
  });

  it('leaves something already short alone', () => {
    expect(shortAddress('0x1234')).toBe('0x1234');
  });
});
