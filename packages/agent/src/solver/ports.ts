/**
 * The ports `processIntent` depends on.
 *
 * Each has a local implementation used by the deterministic lifecycle and a
 * sponsor implementation substituted later. The orchestration below knows none
 * of them by name — which is what lets The Graph, a Circle Agent Wallet and
 * real CCTP arrive one at a time without the solver changing.
 */

import type { Bytes32, SignedFillAuthorization, TxHash, UnixSeconds } from '@arcaidia/domain';

/** Submits a signed authorization to the destination vault. */
export interface FillSubmitter {
  /**
   * @returns the destination transaction hash.
   * @throws if submission fails; the caller decides whether to retry.
   */
  submitFastFill(
    chainId: number,
    vault: `0x${string}`,
    signed: SignedFillAuthorization,
  ): Promise<TxHash>;
}

/**
 * Supplies agent-side nonces.
 *
 * Separate from the intent's own nonce: the vault tracks these independently so
 * a single compromised or duplicated authorization cannot be replayed even for
 * a different intent.
 */
export interface NonceSource {
  next(): Promise<bigint> | bigint;
}

/** Wall clock, injected so tests are not at the mercy of real time. */
export type Clock = () => UnixSeconds;

/** A monotonically increasing in-memory nonce source, for local runs and tests. */
export class SequentialNonceSource implements NonceSource {
  private current: bigint;

  constructor(start = 1n) {
    this.current = start;
  }

  next(): bigint {
    const value = this.current;
    this.current += 1n;
    return value;
  }
}

/**
 * Random nonces, for a live process.
 *
 * Found live, 2026-09-10: `SequentialNonceSource` starts over at 1 every time
 * the process restarts, but `agentNonceUsed` on the vault is permanent,
 * onchain state — the first fill attempted after *any* restart collides with
 * nonce 1 from whichever earlier run already used it, and reverts
 * (`AgentNonceAlreadyUsed`) every time thereafter, for that one intent,
 * forever. Nothing about the vault requires sequential nonces — only that
 * each one is unused — so a large random value makes a same-process collision
 * astronomically unlikely without needing to persist anything across
 * restarts. Same approach the frontend's own `createIntent` nonce already
 * uses (`apps/web/src/hooks/arcaidia/use-intent.tsx`'s `randomNonce`).
 */
export class RandomNonceSource implements NonceSource {
  next(): bigint {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
  }
}

/** Records the intents this process has already acted on, to avoid duplicate work. */
export interface SubmissionJournal {
  has(intentId: Bytes32): boolean;
  mark(intentId: Bytes32): void;
}

/** In-memory journal. Onchain state remains authoritative; this only saves work. */
export class InMemorySubmissionJournal implements SubmissionJournal {
  private readonly seen = new Set<string>();

  has(intentId: Bytes32): boolean {
    return this.seen.has(intentId.toLowerCase());
  }

  mark(intentId: Bytes32): void {
    this.seen.add(intentId.toLowerCase());
  }
}
