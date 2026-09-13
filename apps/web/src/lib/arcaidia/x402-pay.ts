/**
 * WP-35 — paying for one intelligence answer from the browser, with a Hedera testnet account
 * the visitor types in. Everything stays in this tab: the key signs one `TransferTransaction`
 * for exactly the amount the gateway's 402 quotes (capped below), the facilitator submits it,
 * and the gateway returns the answer with the settlement receipt. Nothing is stored, nothing
 * is sent anywhere but the gateway. The x402 and Hedera SDK code is loaded on demand so the
 * rest of the site never pays for it.
 */
export const HEDERA_TESTNET = "hedera:testnet" as const;
export const HBAR_ASSET = "0.0.0" as const;
/** 0.05 ℏ — five times the dearest listed price; a gateway asking more is refused before signing. */
export const MAX_TINYBAR_PER_PAYMENT = "5000000";

export interface PaymentReceipt {
  transaction: string;
  payer: string | null;
  network: string;
  amount: string | null;
}

export interface PaidFetchResult {
  status: number;
  ms: number;
  receipt: PaymentReceipt | null;
  body: unknown;
}

export interface PayAndFetchOptions {
  accountId: string;
  privateKey: string;
  url: string;
  fetchImpl?: typeof fetch;
}

export function isHederaAccountId(value: string): boolean {
  return /^0\.0\.[0-9]+$/.test(value.trim());
}

export async function payAndFetch(options: PayAndFetchOptions): Promise<PaidFetchResult> {
  const [{ x402Client }, { wrapFetchWithPayment }, { ExactHederaScheme }, { createClientHederaSigner, PrivateKey }, { decodePaymentResponseHeader }] =
    await Promise.all([
      import("@x402/core/client"),
      import("@x402/fetch"),
      import("@x402/hedera/exact/client"),
      import("@x402/hedera"),
      import("@x402/core/http"),
    ]);
  const key = PrivateKey.fromStringECDSA(options.privateKey.trim().replace(/^0x/i, ""));
  const signer = createClientHederaSigner(options.accountId.trim(), key, { network: HEDERA_TESTNET });
  const client = x402Client.fromConfig({
    schemes: [{ network: HEDERA_TESTNET, client: new ExactHederaScheme(signer) }],
    spendControls: { allowedAssets: [{ network: HEDERA_TESTNET, asset: HBAR_ASSET, maxAmountPerPayment: MAX_TINYBAR_PER_PAYMENT }] },
  });
  const paying = wrapFetchWithPayment(options.fetchImpl ?? fetch, client);
  const started = performance.now();
  const response = await paying(options.url, { headers: { accept: "application/json" } });
  const ms = Math.round(performance.now() - started);
  const header = response.headers.get("payment-response") ?? response.headers.get("x-payment-response");
  let receipt: PaymentReceipt | null = null;
  if (header) {
    try {
      const settled = decodePaymentResponseHeader(header);
      if (settled.success && settled.transaction) {
        receipt = { transaction: settled.transaction, payer: settled.payer ?? null, network: settled.network, amount: settled.amount ?? null };
      }
    } catch {
      receipt = null;
    }
  }
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON — keep the text
  }
  return { status: response.status, ms, receipt, body };
}
