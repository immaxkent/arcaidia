/**
 * Creating an intent the way a user does.
 *
 * Approve, call the router, then read the intent back out of the event the
 * router emitted — rather than constructing it in TypeScript and hoping the
 * chain agrees. Everything downstream is then working from what actually
 * happened, which is the same position the solver is in.
 */

import { createWalletClient, decodeEventLog, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Intent } from '@arcaidia/domain';
import { ARTIFACTS } from './artifacts.js';
import type { AnvilChain } from './anvil.js';
import type { ChainDeployment } from './deploy.js';

export interface CreateIntentParams {
  readonly userKey: Hex;
  readonly recipient: Address;
  readonly amount: bigint;
  readonly destinationChainId: number;
  readonly maxFeeBps: number;
  readonly deadline: number;
  readonly nonce: bigint;
}

export async function createIntent(
  chain: AnvilChain,
  deployment: ChainDeployment,
  params: CreateIntentParams,
): Promise<Intent> {
  const account = privateKeyToAccount(params.userKey);
  const wallet = createWalletClient({ account, chain: chain.chain, transport: http(chain.rpcUrl) });

  const approve = await wallet.writeContract({
    address: deployment.usdc,
    abi: ARTIFACTS.MockUSDC.abi as never,
    functionName: 'approve',
    args: [deployment.router, params.amount] as never,
  } as never);
  await chain.client.waitForTransactionReceipt({ hash: approve });

  const hash = await wallet.writeContract({
    address: deployment.router,
    abi: ARTIFACTS.ArcaidiaIntentRouter.abi as never,
    functionName: 'createIntent',
    args: [
      params.recipient,
      params.amount,
      BigInt(params.destinationChainId),
      params.maxFeeBps,
      BigInt(params.deadline),
      params.nonce,
    ] as never,
  } as never);

  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('createIntent reverted.');

  const block = await chain.client.getBlock({ blockNumber: receipt.blockNumber });

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== deployment.router.toLowerCase()) continue;

    try {
      const decoded = decodeEventLog({
        abi: ARTIFACTS.ArcaidiaIntentRouter.abi,
        eventName: 'IntentCreated',
        topics: log.topics,
        data: log.data,
      });

      const args = decoded.args as unknown as {
        intentId: Hex;
        sender: Address;
        recipient: Address;
        inputToken: Address;
        amount: bigint;
        sourceChainId: bigint;
        destinationChainId: bigint;
        maxFeeBps: number;
        deadline: bigint;
        nonce: bigint;
        settlementRef: Hex;
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
        sourceTxHash: hash,
        sourceBlockNumber: receipt.blockNumber,
        createdAt: Number(block.timestamp),
        settlementRef: args.settlementRef,
      };
    } catch {
      // Not IntentCreated.
    }
  }

  throw new Error('createIntent emitted no IntentCreated event.');
}

/** Everything the settlement worker needs to follow this intent's canonical leg. */
export function settlementRecordFor(intent: Intent, sourceDomain: number, destinationDomain: number) {
  return {
    reference: {
      intentId: intent.intentId,
      sourceChainId: intent.sourceChainId,
      destinationChainId: intent.destinationChainId,
      sourceDomain,
      destinationDomain,
      sourceTxHash: intent.sourceTxHash,
      messageRef: intent.settlementRef,
      initiatedAt: intent.createdAt,
    },
    amount: intent.amount,
    fallbackRecipient: intent.recipient,
  };
}
