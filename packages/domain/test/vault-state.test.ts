import { describe, expect, it } from 'vitest';
import {
  availableLiquidity,
  lpLiquidBalance,
  totalAssets,
  utilisationBps,
  type VaultState,
} from '../src/index.js';
import { ARC, VAULT_A } from './fixtures.js';

function vault(partial: Partial<VaultState> = {}): VaultState {
  return {
    chainId: ARC,
    vault: VAULT_A,
    asset: '0x3600000000000000000000000000000000000000',
    totalBalance: 100_000_000_000n, // 100,000 USDC
    totalShares: 100_000_000_000n,
    reserveFloor: 10_000_000_000n, // 10,000 USDC
    outstandingExposure: 0n,
    accruedProtocolFees: 0n,
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

describe('totalAssets (ERC-4626)', () => {
  it('counts the liquid balance when nothing is advanced', () => {
    expect(totalAssets(vault())).toBe(100_000_000_000n);
  });

  it('includes principal advanced and awaiting reimbursement', () => {
    // The receivable must be counted: an LP redeeming mid-fill would otherwise
    // exit cheaply and leave the remaining LPs carrying the exposure.
    const advanced = vault({ totalBalance: 99_001_000_000n, outstandingExposure: 1_000_000_000n });
    expect(totalAssets(advanced)).toBe(100_001_000_000n);
  });

  it('is never less than the deployable liquidity', () => {
    const advanced = vault({ totalBalance: 50_000_000_000n, outstandingExposure: 50_000_000_000n });
    expect(totalAssets(advanced)).toBeGreaterThanOrEqual(availableLiquidity(advanced));
  });
});

describe('protocol fees are not LP capital', () => {
  /// Mirrors the contract exactly. An agent that treated accrued fees as
  /// deployable would price against liquidity it is not allowed to lend.
  it('excludes accrued fees from the LP liquid balance', () => {
    const v = vault({ accruedProtocolFees: 50_000_000n });
    expect(lpLiquidBalance(v)).toBe(100_000_000_000n - 50_000_000n);
  });

  it('excludes accrued fees from total assets', () => {
    const v = vault({ accruedProtocolFees: 50_000_000n });
    expect(totalAssets(v)).toBe(100_000_000_000n - 50_000_000n);
  });

  it('excludes accrued fees from deployable liquidity', () => {
    const withFees = vault({ accruedProtocolFees: 50_000_000n });
    expect(availableLiquidity(withFees)).toBe(availableLiquidity(vault()) - 50_000_000n);
  });

  it('never reports a negative LP balance', () => {
    expect(lpLiquidBalance(vault({ totalBalance: 1n, accruedProtocolFees: 5n }))).toBe(0n);
  });

  it('counts fees in neither side of the utilisation ratio', () => {
    const clean = vault({ totalBalance: 50_000_000_000n, outstandingExposure: 50_000_000_000n });
    const withFees = { ...clean, totalBalance: clean.totalBalance + 1_000_000n, accruedProtocolFees: 1_000_000n };
    expect(utilisationBps(withFees)).toBe(utilisationBps(clean));
  });
});
