/**
 * Submits fast fills over RPC.
 *
 * Authority rests on the recovered EIP-712 signer, not on whoever sends the
 * transaction, so this client is an ordinary relayer: compromising it gains
 * nothing beyond the ability to submit authorizations the agent already signed.
 */

import { ABIS, type Address, type Intent, type SignedFillAuthorization, type TxHash } from '@arcaidia/domain';
import type { EvmReceiptWaiter, EvmWriteClient } from './evm-clients.js';
import type { FillSubmitter } from '../solver/ports.js';

const VAULT_ABI = ABIS.ArcaidiaLiquidityVault as readonly unknown[];

/**
 * The fill transaction was mined and reverted. Under first-valid-fill the overwhelmingly likely
 * cause is that another vault's fill landed first (`IntentAlreadyClaimed`): the race was lost,
 * no capital moved, only gas was spent. Carries the hash so the loss is auditable.
 */
export class FillRevertedError extends Error {
  constructor(readonly txHash: TxHash) {
    super(`fastFill ${txHash} reverted on chain — another vault won this intent first.`);
    this.name = 'FillRevertedError';
  }
}

export class ViemFillSubmitter implements FillSubmitter {
  /**
   * @param clients   one write client per chain (the submitter key)
   * @param receipts  optional per-chain receipt waiters; with one configured, a fill is only
   *                  reported as landed once its receipt says `success`, and a reverted receipt
   *                  is a `FillRevertedError` rather than a "FILLED" that never happened.
   */
  constructor(
    private readonly clients: ReadonlyMap<number, EvmWriteClient>,
    private readonly receipts: ReadonlyMap<number, EvmReceiptWaiter> = new Map(),
  ) {}

  async submitFastFill(
    chainId: number,
    vault: Address,
    intent: Intent,
    signed: SignedFillAuthorization,
  ): Promise<TxHash> {
    const client = this.clients.get(chainId);
    if (!client) throw new Error(`No write client configured for chain ${chainId}.`);

    const { authorization } = signed;

    const txHash = await client.writeContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'fastFill',
      args: [
        // The canonical intent, in preimage order (IntentParams) — the vault recomputes the id.
        {
          intentVersion: intent.intentVersion,
          sender: intent.sender,
          recipient: intent.recipient,
          inputToken: intent.inputToken,
          amount: intent.amount,
          sourceChainId: BigInt(intent.sourceChainId),
          destinationChainId: BigInt(intent.destinationChainId),
          maxFeeBps: intent.maxFeeBps,
          deadline: BigInt(intent.deadline),
          nonce: intent.nonce,
          tokenOut: intent.tokenOut,
          targetMinOut: intent.targetMinOut,
        },
        {
          intentId: authorization.intentId,
          sourceChainId: BigInt(authorization.sourceChainId),
          sourceTxHash: authorization.sourceTxHash,
          recipient: authorization.recipient,
          inputAmount: authorization.inputAmount,
          outputAmount: authorization.outputAmount,
          feeAmount: authorization.feeAmount,
          expiry: BigInt(authorization.expiry),
          nonce: authorization.nonce,
        },
        signed.signature,
      ],
    });

    const waiter = this.receipts.get(chainId);
    if (waiter) {
      const receipt = await waiter.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === 'reverted') throw new FillRevertedError(txHash);
    }
    return txHash;
  }
}
