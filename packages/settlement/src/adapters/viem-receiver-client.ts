/**
 * The destination `SettlementReceiver`, over RPC.
 *
 * The outcome is read from the event the transaction emitted rather than from a
 * return value: a transaction's return data is not available to the sender, and
 * guessing which branch ran would defeat the point of having two of them.
 */

import { toEventSelector } from 'viem';
import { ABIS, type Address, type Bytes32, type TxHash } from '@arcaidia/domain';
import type { SettlementOutcomeReport, SettlementReceiverClient } from '../worker/ports.js';

const RECEIVER_ABI = ABIS.SettlementReceiver as readonly unknown[];

export interface ReceiverReadClient {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
  waitForTransactionReceipt(args: { hash: TxHash }): Promise<{
    status: 'success' | 'reverted';
    logs: readonly { address: Address; topics: readonly `0x${string}`[]; data: `0x${string}` }[];
  }>;
}

export interface ReceiverWriteClient {
  writeContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<TxHash>;
}

export class ViemSettlementReceiverClient implements SettlementReceiverClient {
  constructor(
    private readonly readers: ReadonlyMap<number, ReceiverReadClient>,
    private readonly writers: ReadonlyMap<number, ReceiverWriteClient>,
  ) {}

  async isSettled(chainId: number, receiver: Address, intentId: Bytes32): Promise<boolean> {
    const reader = this.require(this.readers, chainId, 'read');
    return (await reader.readContract({
      address: receiver,
      abi: RECEIVER_ABI,
      functionName: 'isSettled',
      args: [intentId],
    })) as boolean;
  }

  async settle(
    chainId: number,
    receiver: Address,
    intentId: Bytes32,
    fallbackRecipient: Address,
    amount: bigint,
  ): Promise<SettlementOutcomeReport> {
    const writer = this.require(this.writers, chainId, 'write');
    const reader = this.require(this.readers, chainId, 'read');

    const txHash = await writer.writeContract({
      address: receiver,
      abi: RECEIVER_ABI,
      functionName: 'settle',
      args: [intentId, fallbackRecipient, amount],
    });

    const receipt = await reader.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new Error(`Settlement transaction ${txHash} reverted.`);
    }

    return { txHash, outcome: outcomeFromLogs(receipt.logs, receiver) };
  }

  private require<T>(source: ReadonlyMap<number, T>, chainId: number, kind: string): T {
    const client = source.get(chainId);
    if (!client) throw new Error(`No ${kind} client configured for chain ${chainId}.`);
    return client;
  }
}

/**
 * Which branch ran, read from the event topic.
 *
 * Matched on `topics[0]` rather than by attempting to decode against each event
 * in turn: `decodeEventLog` given an explicit `eventName` will decode whatever
 * it is handed without checking that the log is actually that event, so a
 * try-each loop reports whichever event it tried first for *every* settlement.
 * That is silent and total — every fallback would be recorded as an LP
 * reimbursement.
 */
const LP_REIMBURSED_TOPIC = toEventSelector('LpReimbursed(bytes32,uint256)');
const RECIPIENT_FALLBACK_TOPIC = toEventSelector(
  'RecipientPaidByFallback(bytes32,address,uint256)',
);

function outcomeFromLogs(
  logs: readonly { address: Address; topics: readonly `0x${string}`[]; data: `0x${string}` }[],
  receiver: Address,
): SettlementOutcomeReport['outcome'] {
  for (const log of logs) {
    if (log.address.toLowerCase() !== receiver.toLowerCase()) continue;

    const topic = log.topics[0]?.toLowerCase();
    if (topic === LP_REIMBURSED_TOPIC.toLowerCase()) return 'LP_REIMBURSED';
    if (topic === RECIPIENT_FALLBACK_TOPIC.toLowerCase()) return 'RECIPIENT_FALLBACK';
  }

  throw new Error('Settlement transaction emitted neither outcome event.');
}
