/**
 * What the settlement worker talks to.
 *
 * Two ports and a journal. The journal is a queue and a cache — never a
 * substitute for onchain state, which is why every run re-asks the chain before
 * acting.
 */

import type { Address, Bytes32, SettlementReference, TxHash, UnixSeconds } from '@arcaidia/domain';

/** Where canonical funds should go if nobody fast-filled the intent. */
export interface SettlementRecord {
  readonly reference: SettlementReference;
  /** Canonical amount in flight, in the asset's smallest unit. */
  readonly amount: bigint;
  /** The intent's recipient, paid directly when no solver participated. */
  readonly fallbackRecipient: Address;
}

export interface SettlementOutcomeReport {
  readonly txHash: TxHash;
  readonly outcome: 'LP_REIMBURSED' | 'RECIPIENT_FALLBACK';
}

/** The destination `SettlementReceiver`, as the worker sees it. */
export interface SettlementReceiverClient {
  /**
   * Onchain settlement state.
   *
   * Asked before every action. The worker's own journal can be stale, wrong, or
   * belong to a different process; the chain cannot.
   */
  isSettled(chainId: number, receiver: Address, intentId: Bytes32): Promise<boolean>;

  settle(
    chainId: number,
    receiver: Address,
    intentId: Bytes32,
    fallbackRecipient: Address,
    amount: bigint,
  ): Promise<SettlementOutcomeReport>;
}

/** Work the process is tracking. Durable in production, in-memory in tests. */
export interface SettlementJournal {
  add(record: SettlementRecord): void;
  pending(): readonly SettlementRecord[];
  /** Records a completed settlement, with the time it took. */
  markSettled(intentId: Bytes32, at: UnixSeconds): void;
  isSettled(intentId: Bytes32): boolean;
  settledAt(intentId: Bytes32): UnixSeconds | undefined;
  all(): readonly SettlementRecord[];
}

export class InMemorySettlementJournal implements SettlementJournal {
  private readonly records = new Map<string, SettlementRecord>();
  private readonly settled = new Map<string, UnixSeconds>();

  add(record: SettlementRecord): void {
    this.records.set(key(record.reference.intentId), record);
  }

  pending(): readonly SettlementRecord[] {
    return [...this.records.values()].filter((r) => !this.settled.has(key(r.reference.intentId)));
  }

  markSettled(intentId: Bytes32, at: UnixSeconds): void {
    this.settled.set(key(intentId), at);
  }

  isSettled(intentId: Bytes32): boolean {
    return this.settled.has(key(intentId));
  }

  settledAt(intentId: Bytes32): UnixSeconds | undefined {
    return this.settled.get(key(intentId));
  }

  all(): readonly SettlementRecord[] {
    return [...this.records.values()];
  }
}

const key = (intentId: Bytes32): string => intentId.toLowerCase();
