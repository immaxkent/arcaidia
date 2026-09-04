import { describe, expect, it } from 'vitest';
import { availableLiquidity, utilisationBps, type VaultState } from '../src/index.js';
import { ARC, VAULT_A } from './fixtures.js';

function vault(partial: Partial<VaultState> = {}): VaultState {
  return {
    chainId: ARC,
    vault: VAULT_A,
    asset: '0x3600000000000000000000000000000000000000',
    totalBalance: 100_000_000_000n, // 100,000 USDC
    reserveFloor: 10_000_000_000n, // 10,000 USDC
    outstandingExposure: 0n,
    paused: false,
    blockNumber: 1n,
    observedAt: 1_800_000_000,
    ...partial,
  };
}

describe('availableLiquidity', () => {
  it('excludes the reserve floor', () => {
    expect(availableLiquidity(vault())).toBe(90_000_000_000n);
  });

  it('never returns a negative figure when the balance is below the floor', () => {
    expect(availableLiquidity(vault({ totalBalance: 5_000_000_000n }))).toBe(0n);
  });

  it('returns zero when the balance is exactly the floor', () => {
    expect(availableLiquidity(vault({ totalBalance: 10_000_000_000n }))).toBe(0n);
  });
});

describe('utilisationBps', () => {
  it('is zero when nothing is advanced', () => {
    expect(utilisationBps(vault())).toBe(0);
  });

  it('measures advanced principal against total capital', () => {
    // 50,000 advanced against 50,000 remaining = 50% of 100,000 capital.
    expect(
      utilisationBps(vault({ totalBalance: 50_000_000_000n, outstandingExposure: 50_000_000_000n })),
    ).toBe(5_000);
  });

  it('reads an empty vault as fully utilised rather than dividing by zero', () => {
    expect(utilisationBps(vault({ totalBalance: 0n, outstandingExposure: 0n }))).toBe(10_000);
  });
});
