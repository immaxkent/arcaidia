import { describe, expect, it } from 'vitest';
import { sliceToSell } from '../src/sweep.js';

describe('sliceToSell', () => {
  it('sells everything when the value fits the pool share, else the slice that does', () => {
    const reserve = 40_000_000n; // 40 USDC in the pool; 8% cap = 3.2 USDC
    expect(sliceToSell(10n ** 18n, 2_000_000n, reserve, 800n)).toBe(10n ** 18n);
    // 50 USDC of tokens: sell 3.2/50 of the balance this round
    expect(sliceToSell(10n ** 18n, 50_000_000n, reserve, 800n)).toBe((10n ** 18n * 3_200_000n) / 50_000_000n);
    expect(sliceToSell(0n, 1n, reserve, 800n)).toBe(0n);
    expect(sliceToSell(10n ** 18n, 0n, reserve, 800n)).toBe(0n);
  });
});
