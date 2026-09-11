/**
 * The crypto boundary for `TELEMETRY PAIRED` (WP-18.1).
 *
 * A plain EIP-191 personal-sign challenge, not EIP-712 typed data: pairing
 * proves possession of an operator key and grants **zero** execution rights
 * (`WP-INTENT-MARKET.md` §7, "two separate lifecycles") — it has no business
 * sharing a signing scheme with `FillAuthorization`, which does move money.
 * `recoverMessageAddress` needs no RPC client for a plain EOA (this
 * reference implementation assumes one, same assumption `AgentAuthority`
 * already makes for fill signing — see `packages/domain/src/ports.ts`).
 */
import { isAddressEqual, recoverMessageAddress } from 'viem';
import type { VaultKey } from './types.js';

export interface ChallengeInput extends VaultKey {
  readonly operatorAddress: `0x${string}`;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * Binds the challenge to exactly one `{chainId, vaultAddress, operatorAddress}`
 * triple, so a signature over one vault's challenge can never be replayed to
 * pair a different vault or a different operator — including two vaults that
 * happen to share an address across chains (see `types.ts`'s `VaultKey`).
 */
export function buildChallengeMessage(input: ChallengeInput): string {
  return [
    'Arcaidia Telemetry Pairing',
    `chainId:${input.chainId}`,
    `vault:${input.vaultAddress.toLowerCase()}`,
    `operator:${input.operatorAddress.toLowerCase()}`,
    `nonce:${input.nonce}`,
    `issuedAt:${input.issuedAt}`,
    `expiresAt:${input.expiresAt}`,
  ].join('\n');
}

export async function verifyChallengeSignature(options: {
  readonly message: string;
  readonly signature: `0x${string}`;
  readonly expectedAddress: `0x${string}`;
}): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({
      message: options.message,
      signature: options.signature,
    });
    return isAddressEqual(recovered, options.expectedAddress);
  } catch {
    // A malformed signature is a failed pairing attempt, not a server error.
    return false;
  }
}
