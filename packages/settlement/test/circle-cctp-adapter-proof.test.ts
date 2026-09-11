import { describe, expect, it } from 'vitest';
import { toEventSelector } from 'viem';
import { SettlementStatus, encodeIntentHook, type Address, type TxHash } from '@arcaidia/domain';
import { CircleCCTPAdapter, type CctpReadClient, type CctpWriteClient } from '../src/index.js';
import { ARC, USDC, reference } from './fixtures.js';
import { FakeIris, MESSAGE_TRANSMITTER } from './cctp-fakes.js';

const RECEIVER: Address = '0x9a47a161ea8328b96Ad976264d42790881570E71';
const RECIPIENT: Address = '0x2222222222222222222222222222222222222222';
const LP_REIMBURSED = toEventSelector('LpReimbursed(bytes32,address,uint256)');
const HELD = toEventSelector('HeldForVault(bytes32,address,uint256)');

/** Records every write and answers receipts with the outcome log a test chooses. */
class RecordingChain implements CctpReadClient, CctpWriteClient {
  writes: Array<{ address: Address; functionName: string; args: readonly unknown[] }> = [];
  outcomeTopic: `0x${string}` = LP_REIMBURSED;
  outcomeEmitter: Address = RECEIVER;

  async readContract(args: { functionName: string }): Promise<unknown> {
    if (args.functionName === 'usedNonces') return 0n;
    throw new Error(`unexpected read ${args.functionName}`);
  }

  async writeContract(args: { address: Address; functionName: string; args: readonly unknown[] }): Promise<TxHash> {
    this.writes.push(args);
    return `0x${'ee'.repeat(32)}` as TxHash;
  }

  async waitForTransactionReceipt(): Promise<{
    status: 'success' | 'reverted';
    logs: readonly { address: Address; topics: readonly `0x${string}`[]; data: `0x${string}` }[];
  }> {
    return { status: 'success', logs: [{ address: this.outcomeEmitter, topics: [this.outcomeTopic], data: '0x' }] };
  }
}

function adapterWith(chain: RecordingChain, iris: FakeIris, receivers = true): CircleCCTPAdapter {
  return new CircleCCTPAdapter({
    irisBaseUrl: 'https://iris.local',
    messageTransmitter: new Map([[ARC, MESSAGE_TRANSMITTER]]),
    ...(receivers ? { settlementReceivers: new Map([[ARC, RECEIVER]]) } : {}),
    readers: new Map([[ARC, chain]]),
    writers: new Map([[ARC, chain]]),
    fetchFn: iris.fetchFn,
    clock: () => 1_800_000_000,
  });
}

/// D8: a commitment that carries the intent hook names the receiver as `destinationCaller`;
/// only `settleWithProof` can receive it — and doing so routes the funds in the same step.
describe('CircleCCTPAdapter — v2 completion through settleWithProof', () => {
  const hooked = (seed: number) =>
    reference(seed, {
      destinationChainId: ARC,
      hookData: encodeIntentHook({ intentId: reference(seed).intentId, recipient: RECIPIENT }),
    });

  it('completes a hooked commitment through the receiver, not the transmitter, and reports RECONCILED with the outcome', async () => {
    const chain = new RecordingChain();
    const iris = new FakeIris();
    const adapter = adapterWith(chain, iris);
    const ref = hooked(1);
    iris.setAttested(ref.sourceDomain, ref.sourceTxHash, 7n);
    adapter.register(ref, USDC(1_000));

    const state = await adapter.complete(ref);

    expect(chain.writes).toHaveLength(1);
    expect(chain.writes[0]).toMatchObject({ address: RECEIVER, functionName: 'settleWithProof' });
    expect(state.status).toBe(SettlementStatus.RECONCILED);
    expect(state.outcome).toBe('LP_REIMBURSED');
    expect(state.destinationTxHash).toBe(`0x${'ee'.repeat(32)}`);
  });

  it('reports HELD_FOR_VAULT when that is what the receiver emitted', async () => {
    const chain = new RecordingChain();
    chain.outcomeTopic = HELD;
    const iris = new FakeIris();
    const adapter = adapterWith(chain, iris);
    const ref = hooked(2);
    iris.setAttested(ref.sourceDomain, ref.sourceTxHash, 8n);
    adapter.register(ref, USDC(1_000));

    expect((await adapter.complete(ref)).outcome).toBe('HELD_FOR_VAULT');
  });

  it('refuses to complete a hooked commitment when no receiver is configured for the chain', async () => {
    const chain = new RecordingChain();
    const iris = new FakeIris();
    const adapter = adapterWith(chain, iris, false);
    const ref = hooked(3);
    iris.setAttested(ref.sourceDomain, ref.sourceTxHash, 9n);
    adapter.register(ref, USDC(1_000));

    await expect(adapter.complete(ref)).rejects.toThrow(/no SettlementReceiver is configured/);
    expect(chain.writes).toHaveLength(0);
  });

  it('still completes an un-hooked (v1) commitment through receiveMessage on the transmitter', async () => {
    const chain = new RecordingChain();
    const iris = new FakeIris();
    const adapter = adapterWith(chain, iris);
    const ref = reference(4, { destinationChainId: ARC });
    iris.setAttested(ref.sourceDomain, ref.sourceTxHash, 10n);
    adapter.register(ref, USDC(1_000));

    const state = await adapter.complete(ref);

    expect(chain.writes[0]).toMatchObject({ address: MESSAGE_TRANSMITTER, functionName: 'receiveMessage' });
    expect(state.status).toBe(SettlementStatus.RECEIVED);
    expect(state.outcome).toBeUndefined();
  });

  it('an outcome event from another contract is not an outcome', async () => {
    const chain = new RecordingChain();
    chain.outcomeEmitter = '0x000000000000000000000000000000000000dEaD';
    const iris = new FakeIris();
    const adapter = adapterWith(chain, iris);
    const ref = hooked(5);
    iris.setAttested(ref.sourceDomain, ref.sourceTxHash, 11n);
    adapter.register(ref, USDC(1_000));

    await expect(adapter.complete(ref)).rejects.toThrow(/no outcome event/);
  });
});
