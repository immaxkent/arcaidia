import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { ABIS, type Address, type TxHash } from '@arcaidia/domain';
import {
  ViemFillSubmitter,
  ViemSourceChainReader,
  decodeIntentCreated,
  type EvmLog,
  type EvmReadClient,
  type EvmReceipt,
  type EvmWriteClient,
} from '../src/index.js';
import { ARC, NOW, SEPOLIA, USDC, intent } from './fixtures.js';

const ROUTER = '0x1111111111111111111111111111111111111111' as const;
const OTHER = '0x9999999999999999999999999999999999999999' as const;
const VAULT = '0x5555555555555555555555555555555555555555' as const;

const source = intent();

interface IntentCreatedValues {
  intentId: `0x${string}`;
  sender: Address;
  recipient: Address;
  inputToken: Address;
  amount: bigint;
  sourceChainId: bigint;
  destinationChainId: bigint;
  maxFeeBps: number;
  deadline: bigint;
  nonce: bigint;
  settlementRef: `0x${string}`;
}

/** Builds a genuine IntentCreated log, encoded exactly as the contract emits it. */
function intentCreatedLog(
  overrides: Partial<IntentCreatedValues> = {},
  emitter: Address = ROUTER,
): EvmLog {
  const values: IntentCreatedValues = {
    intentId: source.intentId,
    sender: source.sender,
    recipient: source.recipient,
    inputToken: source.inputToken,
    amount: source.amount,
    sourceChainId: BigInt(source.sourceChainId),
    destinationChainId: BigInt(source.destinationChainId),
    maxFeeBps: source.maxFeeBps,
    deadline: BigInt(source.deadline),
    nonce: source.nonce,
    settlementRef: source.settlementRef,
    ...overrides,
  };

  const topics = encodeEventTopics({
    abi: ABIS.ArcaidiaIntentRouter as readonly unknown[],
    eventName: 'IntentCreated',
    args: {
      intentId: values.intentId,
      sender: values.sender,
      recipient: values.recipient,
    },
  });

  const data = encodeAbiParameters(
    [
      { name: 'inputToken', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'maxFeeBps', type: 'uint16' },
      { name: 'deadline', type: 'uint64' },
      { name: 'nonce', type: 'uint256' },
      { name: 'settlementRef', type: 'bytes32' },
    ],
    [
      values.inputToken,
      values.amount,
      values.sourceChainId,
      values.destinationChainId,
      values.maxFeeBps,
      values.deadline,
      values.nonce,
      values.settlementRef,
    ],
  );

  return { address: emitter, topics: topics as readonly `0x${string}`[], data };
}

class StubReadClient implements EvmReadClient {
  constructor(
    private readonly receipt: EvmReceipt | Error,
    private readonly head: bigint | Error = 110n,
  ) {}

  async getTransactionReceipt(): Promise<EvmReceipt> {
    if (this.receipt instanceof Error) throw this.receipt;
    return this.receipt;
  }

  async getBlockNumber(): Promise<bigint> {
    if (this.head instanceof Error) throw this.head;
    return this.head;
  }
}

const successfulReceipt: EvmReceipt = {
  status: 'success',
  to: ROUTER,
  blockNumber: 100n,
  logs: [intentCreatedLog()],
};

function reader(client: EvmReadClient): ViemSourceChainReader {
  return new ViemSourceChainReader(
    new Map([[SEPOLIA, client]]),
    new Map([[SEPOLIA, ROUTER]]),
  );
}

describe('decodeIntentCreated', () => {
  it('decodes every field the contract emits', () => {
    const decoded = decodeIntentCreated([intentCreatedLog()], ROUTER);

    expect(decoded).toEqual({
      intentId: source.intentId,
      sender: source.sender,
      recipient: source.recipient,
      inputToken: source.inputToken,
      amount: source.amount,
      sourceChainId: SEPOLIA,
      destinationChainId: ARC,
      maxFeeBps: source.maxFeeBps,
      deadline: source.deadline,
      nonce: source.nonce,
      settlementRef: source.settlementRef,
      emitter: ROUTER,
    });
  });

  /// Anyone can emit an event with our signature. Matching on topic alone would
  /// let any contract fabricate evidence.
  it('ignores an identical event emitted by another contract', () => {
    expect(decodeIntentCreated([intentCreatedLog({}, OTHER)], ROUTER)).toBeNull();
  });

  it('ignores unrelated logs from the router', () => {
    const noise: EvmLog = { address: ROUTER, topics: [`0x${'ee'.repeat(32)}`], data: '0x' };
    expect(decodeIntentCreated([noise], ROUTER)).toBeNull();
  });

  it('finds the event among unrelated logs', () => {
    const noise: EvmLog = { address: OTHER, topics: [`0x${'ee'.repeat(32)}`], data: '0x' };
    const decoded = decodeIntentCreated([noise, intentCreatedLog(), noise], ROUTER);
    expect(decoded?.intentId).toBe(source.intentId);
  });

  it('returns null when there are no logs at all', () => {
    expect(decodeIntentCreated([], ROUTER)).toBeNull();
  });

  it('matches the router address case-insensitively', () => {
    const decoded = decodeIntentCreated([intentCreatedLog()], ROUTER.toUpperCase() as Address);
    expect(decoded?.intentId).toBe(source.intentId);
  });
});

describe('ViemSourceChainReader', () => {
  it('reports a successful transaction with its decoded intent', async () => {
    const evidence = await reader(new StubReadClient(successfulReceipt)).readEvidence(
      SEPOLIA,
      source.sourceTxHash,
    );

    expect(evidence.status).toBe('success');
    expect(evidence.to).toBe(ROUTER);
    expect(evidence.blockNumber).toBe(100n);
    expect(evidence.currentBlockNumber).toBe(110n);
    expect(evidence.intentCreated?.intentId).toBe(source.intentId);
  });

  /// A pending transaction reaches here routinely, so a missing receipt is
  /// evidence rather than an exception: the verifier refuses on it like any
  /// other failed check.
  it('reports a missing receipt as absent status rather than throwing', async () => {
    const evidence = await reader(new StubReadClient(new Error('not found'))).readEvidence(
      SEPOLIA,
      source.sourceTxHash,
    );

    expect(evidence.status).toBeNull();
    expect(evidence.intentCreated).toBeNull();
  });

  it('decodes no intent from a reverted transaction', async () => {
    const reverted: EvmReceipt = { ...successfulReceipt, status: 'reverted' };
    const evidence = await reader(new StubReadClient(reverted)).readEvidence(
      SEPOLIA,
      source.sourceTxHash,
    );

    expect(evidence.status).toBe('reverted');
    expect(evidence.intentCreated).toBeNull();
  });

  /// Guessing a head would be the one way this adapter could cause a premature
  /// fill, so an unreadable head reports zero and the verifier refuses.
  it('reports a zero head when the node cannot be read', async () => {
    const evidence = await reader(
      new StubReadClient(successfulReceipt, new Error('rpc down')),
    ).readEvidence(SEPOLIA, source.sourceTxHash);

    expect(evidence.currentBlockNumber).toBe(0n);
  });

  it('throws for an unconfigured chain', async () => {
    await expect(
      reader(new StubReadClient(successfulReceipt)).readEvidence(999, source.sourceTxHash),
    ).rejects.toThrow(/No RPC client or router configured/);
  });

  it('carries the requested transaction hash through', async () => {
    const evidence = await reader(new StubReadClient(successfulReceipt)).readEvidence(
      SEPOLIA,
      source.sourceTxHash,
    );
    expect(evidence.txHash).toBe(source.sourceTxHash);
  });
});

describe('ViemFillSubmitter', () => {
  class StubWriteClient implements EvmWriteClient {
    calls: Array<{ address: Address; functionName: string; args: readonly unknown[] }> = [];
    failWith: Error | null = null;

    async writeContract(args: {
      address: Address;
      abi: readonly unknown[];
      functionName: string;
      args: readonly unknown[];
    }): Promise<TxHash> {
      if (this.failWith) throw this.failWith;
      this.calls.push({ address: args.address, functionName: args.functionName, args: args.args });
      return `0x${'cd'.repeat(32)}`;
    }
  }

  const signed = {
    authorization: {
      intentId: source.intentId,
      sourceChainId: SEPOLIA,
      sourceTxHash: source.sourceTxHash,
      recipient: source.recipient,
      inputAmount: USDC(1_000),
      outputAmount: USDC(999),
      feeAmount: USDC(1),
      expiry: NOW + 45,
      nonce: 7n,
    },
    signature: `0x${'11'.repeat(65)}` as const,
    signer: '0xa9e0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0' as const,
  };

  it('calls fastFill on the destination vault', async () => {
    const client = new StubWriteClient();
    const submitter = new ViemFillSubmitter(new Map([[ARC, client]]));

    const hash = await submitter.submitFastFill(ARC, VAULT, signed);

    expect(hash).toBe(`0x${'cd'.repeat(32)}`);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({ address: VAULT, functionName: 'fastFill' });
  });

  /// The struct must reach the contract with every field intact and the two
  /// integer fields widened to the types the ABI declares.
  it('passes the authorization and signature unaltered', async () => {
    const client = new StubWriteClient();
    const submitter = new ViemFillSubmitter(new Map([[ARC, client]]));

    await submitter.submitFastFill(ARC, VAULT, signed);
    const [authorization, signature] = client.calls[0]!.args as [Record<string, unknown>, string];

    expect(authorization).toEqual({
      intentId: signed.authorization.intentId,
      sourceChainId: BigInt(SEPOLIA),
      sourceTxHash: signed.authorization.sourceTxHash,
      recipient: signed.authorization.recipient,
      inputAmount: USDC(1_000),
      outputAmount: USDC(999),
      feeAmount: USDC(1),
      expiry: BigInt(NOW + 45),
      nonce: 7n,
    });
    expect(signature).toBe(signed.signature);
  });

  it('throws for an unconfigured chain', async () => {
    const submitter = new ViemFillSubmitter(new Map());
    await expect(submitter.submitFastFill(ARC, VAULT, signed)).rejects.toThrow(
      /No write client configured/,
    );
  });

  /// Submission failures propagate: processIntent decides what a failure means,
  /// because only it knows whether the journal was already marked.
  it('propagates a submission failure', async () => {
    const client = new StubWriteClient();
    client.failWith = new Error('replacement underpriced');
    const submitter = new ViemFillSubmitter(new Map([[ARC, client]]));

    await expect(submitter.submitFastFill(ARC, VAULT, signed)).rejects.toThrow(
      'replacement underpriced',
    );
  });
});
