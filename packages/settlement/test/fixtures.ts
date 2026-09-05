import type { SettlementReference } from '@arcaidia/domain';

export const NOW = 1_800_000_000;
export const USDC = (whole: number): bigint => BigInt(whole) * 1_000_000n;
export const SEPOLIA = 11155111;
export const ARC = 5042002;

/** A mutable clock, so tests advance time rather than wait for it. */
export class TestClock {
  constructor(private t: number = NOW) {}
  now = (): number => this.t;
  advance(seconds: number): void {
    this.t += seconds;
  }
  set(t: number): void {
    this.t = t;
  }
}

export function reference(seed: number, overrides: Partial<SettlementReference> = {}): SettlementReference {
  const hex = seed.toString(16).padStart(4, '0');
  return {
    intentId: `0x${hex.repeat(16)}`.slice(0, 66) as `0x${string}`,
    sourceChainId: SEPOLIA,
    destinationChainId: ARC,
    sourceDomain: 0,
    destinationDomain: 26,
    sourceTxHash: `0x${'a'.repeat(64)}` as `0x${string}`,
    messageRef: `0x${'b'.repeat(64)}` as `0x${string}`,
    initiatedAt: NOW,
    ...overrides,
  };
}

/** The mirrored route: Arc as source, Ethereum as destination. */
export function mirroredReference(seed: number): SettlementReference {
  return reference(seed, {
    sourceChainId: ARC,
    destinationChainId: SEPOLIA,
    sourceDomain: 26,
    destinationDomain: 0,
  });
}
