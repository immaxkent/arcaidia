import {
  CanonicalStatus,
  FastStatus,
  type Intent,
  type SettlementHealth,
  type VaultState,
} from '@arcaidia/domain';
import { DEFAULT_RISK_POLICY } from '../src/index.js';
import type { EvaluationContext } from '../src/index.js';

export const NOW = 1_800_000_000;
export const USDC = (whole: number): bigint => BigInt(whole) * 1_000_000n;

export const SEPOLIA = 11155111;
export const ARC = 5042002;

export { CanonicalStatus, FastStatus, DEFAULT_RISK_POLICY };

export function intent(overrides: Partial<Intent> = {}): Intent {
  return {
    intentId: '0x'.padEnd(66, 'a') as `0x${string}`,
    sender: '0x1111111111111111111111111111111111111111',
    recipient: '0x2222222222222222222222222222222222222222',
    inputToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    amount: USDC(1_000),
    sourceChainId: SEPOLIA,
    destinationChainId: ARC,
    maxFeeBps: 100,
    deadline: NOW + 3_600,
    nonce: 1n,
    sourceTxHash: '0x'.padEnd(66, 'b') as `0x${string}`,
    sourceBlockNumber: 100n,
    createdAt: NOW - 60,
    settlementRef: '0x'.padEnd(66, 'c') as `0x${string}`,
    ...overrides,
  };
}

export function vault(overrides: Partial<VaultState> = {}): VaultState {
  return {
    chainId: ARC,
    vault: '0xAAaA000000000000000000000000000000000001',
    asset: '0x3600000000000000000000000000000000000000',
    totalBalance: USDC(100_000),
    totalShares: USDC(100_000),
    reserveFloor: USDC(10_000),
    outstandingExposure: 0n,
    accruedProtocolFees: 0n,
    paused: false,
    blockNumber: 1n,
    observedAt: NOW,
    ...overrides,
  };
}

export function health(overrides: Partial<SettlementHealth> = {}): SettlementHealth {
  return {
    transport: 'HEALTHY',
    oldestUnsettledAgeSeconds: null,
    pendingValue: 0n,
    averageSettlementLatencySeconds: 120,
    latencySampleSize: 10,
    observedAt: NOW,
    ...overrides,
  };
}

export function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    now: NOW,
    sourceConfirmations: 10,
    alreadyFilled: false,
    ...overrides,
  };
}
