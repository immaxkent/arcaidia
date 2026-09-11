/**
 * Submits fast fills over RPC.
 *
 * Authority rests on the recovered EIP-712 signer, not on whoever sends the
 * transaction, so this client is an ordinary relayer: compromising it gains
 * nothing beyond the ability to submit authorizations the agent already signed.
 */

import { ABIS, type Address, type Intent, type SignedFillAuthorization, type TxHash } from '@arcaidia/domain';
import type { EvmWriteClient } from './evm-clients.js';
import type { FillSubmitter } from '../solver/ports.js';

const VAULT_ABI = ABIS.ArcaidiaLiquidityVault as readonly unknown[];

export class ViemFillSubmitter implements FillSubmitter {
  constructor(private readonly clients: ReadonlyMap<number, EvmWriteClient>) {}

  async submitFastFill(
    chainId: number,
    vault: Address,
    intent: Intent,
    signed: SignedFillAuthorization,
  ): Promise<TxHash> {
    const client = this.clients.get(chainId);
    if (!client) throw new Error(`No write client configured for chain ${chainId}.`);

    const { authorization } = signed;

    return client.writeContract({
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
  }
}
