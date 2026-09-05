/**
 * Reads source-chain evidence over RPC.
 *
 * This is the impure half of verification. It answers one question — what does
 * the chain say about this transaction — and hands back a plain
 * `SourceEvidence`. The judgement stays in `verifySourceTransaction`, which is
 * pure and exhaustively tested; this file only has to fetch and decode.
 *
 * Decoding is separated out as `decodeIntentCreated` so the awkward part —
 * turning a log into typed fields — is testable against a synthetic log without
 * a node.
 */

import { decodeEventLog } from 'viem';
import { ABIS, type Address, type Bytes32, type TxHash } from '@arcaidia/domain';
import type { EvmLog, EvmReadClient } from './evm-clients.js';
import type {
  IntentCreatedEvidence,
  SourceChainReader,
  SourceEvidence,
} from '../verification/source-evidence.js';

const ROUTER_ABI = ABIS.ArcaidiaIntentRouter as readonly unknown[];

/**
 * Decode the first `IntentCreated` emitted by `router` in these logs.
 *
 * Logs from other contracts are ignored rather than trusted: anyone can emit an
 * event with our signature, and a log matched only by topic would let any
 * contract fabricate evidence. The verifier checks the emitter again, so this
 * is defence in depth rather than the only guard.
 */
export function decodeIntentCreated(
  logs: readonly EvmLog[],
  router: Address,
): IntentCreatedEvidence | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== router.toLowerCase()) continue;

    let decoded;
    try {
      decoded = decodeEventLog({
        abi: ROUTER_ABI,
        eventName: 'IntentCreated',
        topics: log.topics as [signature: Hex, ...args: Hex[]],
        data: log.data,
      });
    } catch {
      // Not an IntentCreated, or not one this ABI understands.
      continue;
    }

    const args = decoded.args as unknown as {
      intentId: Bytes32;
      sender: Address;
      recipient: Address;
      inputToken: Address;
      amount: bigint;
      sourceChainId: bigint;
      destinationChainId: bigint;
      maxFeeBps: number;
      deadline: bigint;
      nonce: bigint;
      settlementRef: Bytes32;
    };

    return {
      intentId: args.intentId,
      sender: args.sender,
      recipient: args.recipient,
      inputToken: args.inputToken,
      amount: args.amount,
      sourceChainId: Number(args.sourceChainId),
      destinationChainId: Number(args.destinationChainId),
      maxFeeBps: Number(args.maxFeeBps),
      deadline: Number(args.deadline),
      nonce: args.nonce,
      settlementRef: args.settlementRef,
      emitter: log.address,
    };
  }

  return null;
}

type Hex = `0x${string}`;

export class ViemSourceChainReader implements SourceChainReader {
  /**
   * @param clients One read client per chain id.
   * @param routers The configured router address per chain id.
   */
  constructor(
    private readonly clients: ReadonlyMap<number, EvmReadClient>,
    private readonly routers: ReadonlyMap<number, Address>,
  ) {}

  async readEvidence(chainId: number, txHash: TxHash): Promise<SourceEvidence> {
    const client = this.clients.get(chainId);
    const router = this.routers.get(chainId);

    if (!client || !router) {
      throw new Error(`No RPC client or router configured for chain ${chainId}.`);
    }

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash });
    } catch {
      // A missing receipt is evidence, not an error: the verifier refuses on it
      // like any other failed check, and a pending transaction reaches here
      // routinely.
      return {
        txHash,
        status: null,
        to: null,
        blockNumber: 0n,
        currentBlockNumber: await this.headOrZero(client),
        intentCreated: null,
      };
    }

    const currentBlockNumber = await this.headOrZero(client);

    return {
      txHash,
      status: receipt.status,
      to: receipt.to,
      blockNumber: receipt.blockNumber,
      currentBlockNumber,
      intentCreated:
        receipt.status === 'success' ? decodeIntentCreated(receipt.logs, router) : null,
    };
  }

  /**
   * A head we cannot read is reported as zero, which makes the confirmation
   * count zero and the verifier refuse. Guessing a head would be the one way
   * this adapter could cause a premature fill.
   *
   * The head is read uncached. viem caches it for the polling interval by
   * default, and a head even one block stale reads as fewer confirmations than
   * the chain actually has — which rejects valid intents, intermittently, in a
   * way that looks like a policy decision rather than a caching artefact.
   */
  private async headOrZero(client: EvmReadClient): Promise<bigint> {
    try {
      return await client.getBlockNumber({ cacheTime: 0 });
    } catch {
      return 0n;
    }
  }
}
