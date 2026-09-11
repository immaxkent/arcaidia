import { describe, expect, it } from 'vitest';
import { CHAIN_KEYS, SWAP_INFRASTRUCTURE, marketsFor } from '../src/index.js';

describe('swap infrastructure (Line 1 reservation)', () => {
  it('declares every configured chain, with nothing fabricated until Line 1 commits real addresses', () => {
    for (const key of CHAIN_KEYS) {
      expect(key in SWAP_INFRASTRUCTURE).toBe(true);
      const infra = SWAP_INFRASTRUCTURE[key];
      if (infra === null) {
        expect(marketsFor(key)).toEqual([]);
        continue;
      }
      // Once filled in, every market must be a USDC pair on that same chain with a real address.
      expect(infra.markets.length).toBeGreaterThan(0);
      for (const market of infra.markets) {
        expect(market.chainId).toBe(infra.chainId);
        expect(market.pool).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(market.tokenOut.address).not.toBe('0x0000000000000000000000000000000000000000');
      }
    }
  });
});
