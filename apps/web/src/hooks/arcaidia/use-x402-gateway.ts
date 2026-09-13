/**
 * WP-35 — the Hedera x402 gateway as the browser sees it: its free price list, and a live,
 * unpaid request to a priced route that comes back `402` with the payment terms the gateway
 * actually asks for. Nothing here pays: a solver pays from its own Hedera account (the key
 * never belongs in a browser); this page shows the paywall is real and what it charges.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { SERVICES } from "@/lib/arcaidia/config";
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";

export interface GatewayPricing {
  network: string;
  asset: string;
  payTo: string;
  facilitator: string;
  scheme: string;
  endpoints: Array<{
    id: string;
    method: string;
    path: string;
    example: string;
    description: string;
    price: { tinybar: string; hbar: string };
  }>;
}

export function gatewayBaseUrl(): string | null {
  return SERVICES.x402GatewayUrl?.replace(/\/+$/, "") ?? null;
}

export function useGatewayPricing(): DataState<GatewayPricing> {
  const base = gatewayBaseUrl();
  const query = useQuery({
    queryKey: ["x402-pricing", base],
    enabled: base !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch(`${base}/v1/pricing`);
      if (!response.ok) throw new Error(`Gateway pricing failed: ${response.status}`);
      return (await response.json()) as GatewayPricing;
    },
  });
  if (base === null) return unavailableState("No x402 gateway configured (VITE_X402_GATEWAY_URL)");
  if (query.isPending) return { status: "loading" };
  if (query.isError) return errorState(query.error.message);
  return readyState(query.data);
}

/** One `accepts` entry of the x402 v2 `PAYMENT-REQUIRED` header, as the gateway sends it. */
export interface PaymentChallenge {
  status: number;
  scheme: string | null;
  network: string | null;
  asset: string | null;
  amount: string | null;
  payTo: string | null;
  feePayer: string | null;
  maxTimeoutSeconds: number | null;
  resource: string | null;
  description: string | null;
  rawHeader: string | null;
}

/** The header is base64 JSON (`{x402Version, resource, accepts:[...]}`). Tolerant on purpose. */
export function decodeChallenge(status: number, header: string | null): PaymentChallenge {
  const empty: PaymentChallenge = { status, scheme: null, network: null, asset: null, amount: null, payTo: null, feePayer: null, maxTimeoutSeconds: null, resource: null, description: null, rawHeader: header };
  if (!header) return empty;
  try {
    const decoded = JSON.parse(atob(header)) as {
      resource?: { url?: string; description?: string };
      accepts?: Array<{ scheme?: string; network?: string; asset?: string; amount?: string; payTo?: string; maxTimeoutSeconds?: number; extra?: { feePayer?: string } }>;
    };
    const first = decoded.accepts?.[0];
    return {
      ...empty,
      scheme: first?.scheme ?? null,
      network: first?.network ?? null,
      asset: first?.asset ?? null,
      amount: first?.amount ?? null,
      payTo: first?.payTo ?? null,
      feePayer: first?.extra?.feePayer ?? null,
      maxTimeoutSeconds: first?.maxTimeoutSeconds ?? null,
      resource: decoded.resource?.url ?? null,
      description: decoded.resource?.description ?? null,
    };
  } catch {
    return empty;
  }
}

export function useChallenge() {
  const base = gatewayBaseUrl();
  return useMutation({
    mutationFn: async (path: string): Promise<PaymentChallenge> => {
      if (!base) throw new Error("No x402 gateway configured");
      const response = await fetch(`${base}${path}`, { headers: { accept: "application/json" } });
      return decodeChallenge(response.status, response.headers.get("payment-required"));
    },
  });
}

/** HashScan wants the mirror-node form `0.0.x-seconds-nanos`; the x402 receipt carries `0.0.x@seconds.nanos`. */
export function hashscanTransactionUrl(transactionId: string): string {
  const [account, stamp] = transactionId.split("@");
  const normalised = account && stamp ? `${account}-${stamp.replace(".", "-")}` : transactionId;
  return `https://hashscan.io/testnet/transaction/${normalised}`;
}

export function formatTinybar(tinybar: string): string {
  if (!/^[0-9]+$/.test(tinybar)) return tinybar;
  const value = BigInt(tinybar);
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction} ℏ` : `${whole} ℏ`;
}
