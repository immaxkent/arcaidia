/**
 * WP-34 — what the recipient would actually receive in `tokenOut`, asked of the deployed
 * `UniswapV2SwapAdapter` on the destination chain: `quote(USDC, tokenOut, amountIn)`.
 *
 * `amountIn` is the solver's quoted *output* USDC (the intent amount less the fast-fill fee),
 * because that is what the vault hands the adapter (`_deliver`). So this number already carries
 * the fee and the pool's slippage for this exact size; the chart price does not, and the page
 * never presents the chart price as what the user gets.
 */
import { useQuery } from "@tanstack/react-query";
import { SWAP_INFRASTRUCTURE } from "@arcaidia/domain";
import { chainConfig, swapAdapterFor } from "@/lib/arcaidia/config";
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address } from "@/lib/arcaidia/types";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";

const ADAPTER_QUOTE_ABI = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export interface SwapQuote {
  /** USDC handed to the adapter (smallest units). */
  amountIn: bigint;
  /** `tokenOut` the adapter would deliver right now (token units, 18 decimals in this market). */
  amountOut: bigint;
  tokenOut: Address;
  quotedAt: number;
}

/** The floor the intent carries: the adapter's quote less the user's slippage tolerance. Exact integer arithmetic. */
export function targetMinOutFrom(quotedOut: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10_000) throw new Error("slippage must be 0–10000 bps");
  return (quotedOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** The market's token entry for `tokenOut` on `chainId`, from the committed config. */
export function marketToken(chainId: number, tokenOut: Address | null) {
  if (!tokenOut) return null;
  for (const infra of Object.values(SWAP_INFRASTRUCTURE)) {
    if (!infra || infra.chainId !== chainId) continue;
    return infra.markets.find((m) => m.tokenOut.address.toLowerCase() === tokenOut.toLowerCase()) ?? null;
  }
  return null;
}

export function useSwapQuote(chainId: number, tokenOut: Address | null, amountIn: bigint | null): DataState<SwapQuote> {
  const adapter = swapAdapterFor(chainId);
  const usdc = chainConfig(chainId)?.usdc ?? null;
  const enabled = adapter !== null && usdc !== null && tokenOut !== null && amountIn !== null && amountIn > 0n;
  const query = useQuery({
    queryKey: ["swap-quote", chainId, tokenOut, amountIn?.toString() ?? null],
    enabled,
    refetchInterval: 15_000,
    queryFn: async (): Promise<SwapQuote> => {
      const client = publicClientFor(chainId);
      if (!client || !adapter || !usdc || !tokenOut || amountIn === null) throw new Error("Swap quote not configured");
      const amountOut = (await client.readContract({
        address: adapter,
        abi: ADAPTER_QUOTE_ABI,
        functionName: "quote",
        args: [usdc as Address, tokenOut, amountIn],
      })) as bigint;
      return { amountIn, amountOut, tokenOut, quotedAt: Math.floor(Date.now() / 1000) };
    },
  });
  if (adapter === null) return unavailableState("No swap adapter on this chain");
  if (tokenOut === null) return unavailableState("Pick a token");
  if (amountIn === null || amountIn <= 0n) return unavailableState("Enter an amount");
  if (query.isPending) return { status: "loading" };
  if (query.isError) return errorState(query.error.message);
  return readyState(query.data);
}
