import type { Address, Bytes32, TxHash } from '@arcaidia/domain';
import type { SettlementOutcomeReport, SettlementReceiverClient } from '../src/index.js';

/**
 * A settlement receiver that behaves like the contract: idempotent by
 * rejection, and routing by whether the intent was fast-filled.
 */
export class FakeReceiverClient implements SettlementReceiverClient {
  /** Intents the vault reports as fast-filled. */
  readonly filled = new Set<string>();
  /** Intents already settled onchain. */
  readonly settledOnchain = new Set<string>();

  settleCalls: Array<{ intentId: Bytes32; recipient: Address; amount: bigint }> = [];
  isSettledCalls = 0;

  failSettleWith: Error | null = null;
  failIsSettledWith: Error | null = null;

  /** Simulates the transaction landing despite the client reporting a failure. */
  landDespiteFailure = false;

  async isSettled(_chainId: number, _receiver: Address, intentId: Bytes32): Promise<boolean> {
    this.isSettledCalls += 1;
    if (this.failIsSettledWith) throw this.failIsSettledWith;
    return this.settledOnchain.has(intentId.toLowerCase());
  }

  async settle(
    _chainId: number,
    _receiver: Address,
    intentId: Bytes32,
    fallbackRecipient: Address,
    amount: bigint,
  ): Promise<SettlementOutcomeReport> {
    const key = intentId.toLowerCase();

    if (this.settledOnchain.has(key)) {
      throw new Error(`AlreadySettled(${intentId})`);
    }

    if (this.failSettleWith) {
      // A timeout does not mean the transaction failed to land.
      if (this.landDespiteFailure) this.settledOnchain.add(key);
      throw this.failSettleWith;
    }

    this.settledOnchain.add(key);
    this.settleCalls.push({ intentId, recipient: fallbackRecipient, amount });

    return {
      txHash: `0x${key.slice(2, 10).padEnd(64, 'c')}` as TxHash,
      outcome: this.filled.has(key) ? 'LP_REIMBURSED' : 'RECIPIENT_FALLBACK',
    };
  }
}
