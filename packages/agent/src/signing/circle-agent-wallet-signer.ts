/**
 * The Circle Agent Wallet authority (WP-09).
 *
 * Signs `FillAuthorization` typed data through Circle's Developer-Controlled
 * Wallets REST API instead of a locally held private key — the MPC key
 * shares never leave Circle's infrastructure, and this process only ever
 * sees a signature. Behind the same `AgentAuthority` interface as
 * `LocalAgentSigner`; `processIntent` and everything upstream of it is
 * unchanged (DECISIONS.md, D2/D3).
 *
 * `CircleSigningClient` is the one method this class needs from Circle's SDK
 * client (`CircleDeveloperControlledWalletsClient.signTypedData`), narrowed
 * so tests inject a fake instead of making a network call. The real client
 * comes from `buildCircleSigningClient` below, used only by the live
 * entrypoint's dependency wiring.
 */

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import {
  fillAuthorizationTypedData,
  type Address,
  type AgentAuthority,
  type FillAuthorization,
  type Hex,
  type SignedFillAuthorization,
} from '@arcaidia/domain';

export class CircleSigningError extends Error {}

/**
 * The `EIP712Domain` type definition, standard eth_signTypedData_v4 wire
 * format (used by MetaMask, Circle's remote signer, etc). `fillAuthorizationTypedData`
 * omits it because viem's own `signTypedData` derives it implicitly from the
 * `domain` object — Circle's API parses the JSON directly and needs it
 * explicit, so it's added only at the wire boundary, not in the shared
 * domain-package helper (which stays viem's contract, unchanged).
 */
const EIP712_DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

/** bigint fields (uint256/uint64) don't survive JSON.stringify by default. */
function typedDataToJson(authorization: FillAuthorization, domain: { chainId: number; verifyingContract: Address }): string {
  const typedData = fillAuthorizationTypedData(authorization, domain);
  return JSON.stringify(
    {
      ...typedData,
      types: { EIP712Domain: EIP712_DOMAIN_TYPE, ...typedData.types },
    },
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
  );
}

export interface CircleSigningClient {
  signTypedData(input: {
    readonly walletId: string;
    readonly data: string;
  }): Promise<{ readonly data?: { readonly signature?: string } }>;
}

/** Wraps Circle's real SDK client behind `CircleSigningClient` — the only place this process calls out to Circle. */
export function buildCircleSigningClient(config: {
  readonly apiKey: string;
  readonly entitySecret: string;
}): CircleSigningClient {
  return initiateDeveloperControlledWalletsClient(config);
}

const EVM_SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

export class CircleAgentWalletSigner implements AgentAuthority {
  constructor(
    private readonly client: CircleSigningClient,
    readonly address: Address,
    private readonly walletId: string,
  ) {}

  async signFillAuthorization(
    authorization: FillAuthorization,
    domain: { chainId: number; verifyingContract: Address },
  ): Promise<SignedFillAuthorization> {
    const response = await this.client.signTypedData({
      walletId: this.walletId,
      data: typedDataToJson(authorization, domain),
    });

    const signature = response.data?.signature;
    if (!signature) {
      throw new CircleSigningError('Circle signTypedData returned no signature.');
    }
    if (!EVM_SIGNATURE_PATTERN.test(signature)) {
      throw new CircleSigningError(
        `Circle signTypedData returned a signature in an unexpected format: ${signature}`,
      );
    }

    return { authorization, signature: signature as Hex, signer: this.address };
  }
}
