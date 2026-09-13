/**
 * WP-35 — the price list for the paid intelligence endpoints, in one place so the gateway's
 * middleware, the free `/v1/pricing` directory and the web app's `/intelligence` page all
 * describe the same thing.
 *
 * Prices are in HBAR on Hedera testnet, denominated in tinybar (1 HBAR = 10^8 tinybar) because
 * that is how the x402 `exact` scheme's `AssetAmount` carries them; asset `0.0.0` is the HBAR
 * sentinel `@x402/hedera` recognises. Small on purpose: this is a per-request micro-payment
 * from a solver deciding whether to fill, not a subscription.
 */

/** The x402 network identifier for Hedera testnet (CAIP-2 style, as `@x402/hedera` expects). */
export const HEDERA_TESTNET_NETWORK = 'hedera:testnet' as const;

/** HBAR's asset identifier on the x402 wire. */
export const HBAR_ASSET = '0.0.0' as const;

export const TINYBAR_PER_HBAR = 100_000_000n;

export interface PricedEndpoint {
  /** Stable key the web page and README use to name the endpoint. */
  readonly id: 'ecosystem' | 'chain' | 'vault' | 'quote-context';
  /** The route pattern as `@x402/express` wants it: `METHOD /path`, `*` for a wildcard segment. */
  readonly pattern: string;
  /** A concrete example path a client can call, for the directory and docs. */
  readonly example: string;
  readonly description: string;
  /** Price in tinybar. */
  readonly tinybar: bigint;
}

export const PRICED_ENDPOINTS: readonly PricedEndpoint[] = [
  {
    id: 'ecosystem',
    pattern: 'GET /v1/intelligence/ecosystem',
    example: '/v1/intelligence/ecosystem',
    description: 'Cross-chain liquidity, utilisation, fee distribution, fill velocity and settlement latency.',
    tinybar: 1_000_000n, // 0.01 HBAR
  },
  {
    id: 'chain',
    pattern: 'GET /v1/intelligence/chain/*',
    example: '/v1/intelligence/chain/5042002',
    description: 'One destination chain: its vaults, available liquidity and pending CCTP exposure.',
    tinybar: 500_000n, // 0.005 HBAR
  },
  {
    id: 'vault',
    pattern: 'GET /v1/intelligence/vault/*',
    example: '/v1/intelligence/vault/5042002/0xB4bA190D5C78869366e7963f5CcCf4c3167d855C',
    description: 'One vault: utilisation, current fee, recent fills and reimbursement latency.',
    tinybar: 500_000n, // 0.005 HBAR
  },
  {
    id: 'quote-context',
    pattern: 'GET /v1/intelligence/quote-context',
    example: '/v1/intelligence/quote-context?amount=20000000&destinationChainId=5042002',
    description: 'For one intent size and destination: which vaults could fill it and the fee band to expect.',
    tinybar: 2_000_000n, // 0.02 HBAR
  },
];

export function formatHbar(tinybar: bigint): string {
  const whole = tinybar / TINYBAR_PER_HBAR;
  const fraction = (tinybar % TINYBAR_PER_HBAR).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction} HBAR` : `${whole} HBAR`;
}

/** The free, machine-readable directory the gateway serves at `/v1/pricing`. */
export interface PricingDirectory {
  readonly network: typeof HEDERA_TESTNET_NETWORK;
  readonly asset: typeof HBAR_ASSET;
  readonly payTo: string;
  readonly facilitator: string;
  readonly scheme: 'exact';
  readonly endpoints: ReadonlyArray<{
    readonly id: PricedEndpoint['id'];
    readonly method: 'GET';
    readonly path: string;
    readonly example: string;
    readonly description: string;
    readonly price: { readonly tinybar: string; readonly hbar: string };
  }>;
}

export function pricingDirectory(payTo: string, facilitator: string): PricingDirectory {
  return {
    network: HEDERA_TESTNET_NETWORK,
    asset: HBAR_ASSET,
    payTo,
    facilitator,
    scheme: 'exact',
    endpoints: PRICED_ENDPOINTS.map((endpoint) => ({
      id: endpoint.id,
      method: 'GET',
      path: endpoint.pattern.replace(/^GET /, ''),
      example: endpoint.example,
      description: endpoint.description,
      price: { tinybar: endpoint.tinybar.toString(), hbar: formatHbar(endpoint.tinybar) },
    })),
  };
}
