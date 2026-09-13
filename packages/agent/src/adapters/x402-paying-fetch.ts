/**
 * WP-35 — a `fetch` that pays for `402 Payment Required` answers over Hedera x402.
 *
 * `@x402/fetch` does the protocol: on a 402 it reads `PAYMENT-REQUIRED`, has the Hedera
 * scheme build and sign a `TransferTransaction` from this operator's account to the gateway's
 * `payTo` for exactly the quoted tinybar, and retries with `PAYMENT-SIGNATURE`. What this file
 * adds is the ledger: every settled receipt the gateway hands back in `PAYMENT-RESPONSE` is
 * decoded and kept, so the decision log, the heartbeat and the console can all say "this
 * answer cost 0.01 HBAR, transaction 0.0.x@…" rather than just "intelligence: yes".
 *
 * The private key is used to sign transfers and for nothing else; it is never logged and never
 * leaves the process. Absent credentials mean no paying fetch and the solver reads the free
 * relay endpoint exactly as WP-33 left it.
 */

import { x402Client } from '@x402/core/client';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import { PrivateKey, createClientHederaSigner } from '@x402/hedera';
import type { IntelligencePaymentReceipt } from '@arcaidia/domain';

export const HEDERA_TESTNET_NETWORK = 'hedera:testnet' as const;
/** HBAR's asset id on the x402 wire, as the gateway prices in. */
export const HBAR_ASSET = '0.0.0' as const;

/** Running totals for the heartbeat and the console's INTEL pill. */
export interface PaymentLedgerSummary {
  readonly payments: number;
  /** Sum of the reported amounts, in tinybar, for receipts that carried one. */
  readonly totalTinybar: bigint;
  readonly last: IntelligencePaymentReceipt | null;
}

export class PaymentLedger {
  private payments = 0;
  private totalTinybar = 0n;
  private last: IntelligencePaymentReceipt | null = null;

  constructor(private readonly clock: () => number = () => Math.floor(Date.now() / 1000)) {}

  /** Reads `PAYMENT-RESPONSE` (or the legacy `X-PAYMENT-RESPONSE`) off a paid response, if present. */
  recordFrom(response: Response): IntelligencePaymentReceipt | null {
    const header = response.headers.get('payment-response') ?? response.headers.get('x-payment-response');
    if (!header) return null;
    let settled;
    try {
      settled = decodePaymentResponseHeader(header);
    } catch {
      return null;
    }
    if (!settled.success || !settled.transaction) return null;
    const receipt: IntelligencePaymentReceipt = {
      network: settled.network,
      transaction: settled.transaction,
      payer: settled.payer ?? null,
      amount: settled.amount ?? null,
      paidAt: this.clock(),
    };
    this.payments += 1;
    if (receipt.amount && /^[0-9]+$/.test(receipt.amount)) this.totalTinybar += BigInt(receipt.amount);
    this.last = receipt;
    return receipt;
  }

  summary(): PaymentLedgerSummary {
    return { payments: this.payments, totalTinybar: this.totalTinybar, last: this.last };
  }
}

export interface HederaPayingFetchOptions {
  /** `0.0.x` — the account the transfers are debited from. */
  readonly accountId: string;
  /** ECDSA private key, hex (with or without `0x`) or DER. Never logged. */
  readonly privateKey: string;
  readonly network?: typeof HEDERA_TESTNET_NETWORK;
  readonly fetchImpl?: typeof fetch;
  readonly ledger?: PaymentLedger;
  /**
   * The most one answer may cost, in tinybar. A gateway asking for more is refused by the
   * client before anything is signed (the request then fails and the solver treats it as
   * "no intelligence", never as a blocker). Default 0.05 ℏ — five times the dearest listed price.
   */
  readonly maxTinybarPerPayment?: bigint;
}

export const DEFAULT_MAX_TINYBAR_PER_PAYMENT = 5_000_000n;

export interface HederaPayingFetch {
  readonly fetchImpl: typeof fetch;
  readonly ledger: PaymentLedger;
}

export function parseHederaPrivateKey(raw: string): PrivateKey {
  const trimmed = raw.trim().replace(/^0x/i, '');
  return PrivateKey.fromStringECDSA(trimmed);
}

/**
 * Wraps `fetchImpl` so any 402 from an x402 resource on `hedera:testnet` is paid and retried,
 * and every settled receipt lands in the ledger. Responses that were never 402 pass straight
 * through untouched — a free relay endpoint behind this fetch costs nothing.
 */
export function createHederaPayingFetch(options: HederaPayingFetchOptions): HederaPayingFetch {
  const network = options.network ?? HEDERA_TESTNET_NETWORK;
  const signer = createClientHederaSigner(options.accountId, parseHederaPrivateKey(options.privateKey), { network });
  // HBAR (`0.0.0`) is not one of the client's "default assets" (those are HTS stablecoins), so
  // it has to be allowed explicitly — and capped, so a misconfigured or hostile gateway cannot
  // quote an arbitrary price and have it paid.
  const client = x402Client.fromConfig({
    schemes: [{ network, client: new ExactHederaScheme(signer) }],
    spendControls: {
      allowedAssets: [{ network, asset: HBAR_ASSET, maxAmountPerPayment: (options.maxTinybarPerPayment ?? DEFAULT_MAX_TINYBAR_PER_PAYMENT).toString() }],
    },
  });
  const paying = wrapFetchWithPayment(options.fetchImpl ?? fetch, client);
  const ledger = options.ledger ?? new PaymentLedger();
  const fetchImpl: typeof fetch = async (input, init) => {
    const response = await paying(input, init);
    ledger.recordFrom(response);
    return response;
  };
  return { fetchImpl, ledger };
}
