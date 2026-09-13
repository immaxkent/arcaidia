/**
 * WP-34 — the destination market's prices, from the Line 1 price API (`SERVICES.marketPriceUrl`).
 *
 * Two rules from that API's contract run through everything here. No price is ever a JSON
 * number: `e18` is the exact price scaled by 1e18 as a decimal string (parse with BigInt;
 * `Number(e18) / 1e18` is fine for *plotting*, never for anything money depends on), and
 * `display` is the string to render. A field the API cannot answer is `null`, never zero —
 * a zero price on a trade page would mean a free token.
 */
import { useQuery } from "@tanstack/react-query";
import { SERVICES } from "@/lib/arcaidia/config";
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";

export interface MarketPrice {
  /** Exact, scaled by 1e18, decimal string. */
  e18: string;
  display: string;
  usdcReserve: string;
  tokenReserve: string;
}

export interface MarketOnChain {
  chainId: number;
  chainName: string;
  token: `0x${string}`;
  pair: `0x${string}`;
  price: MarketPrice | null;
  change24hBps: number | null;
  high24h: string | null;
  low24h: string | null;
  sampledAt: number | null;
}

export interface Market {
  symbol: string;
  name: string;
  decimals: number;
  chains: MarketOnChain[];
}

export interface MarketsResponse {
  updatedAt: number;
  markets: Market[];
}

export interface PricePoint {
  t: number;
  e18: string;
  display: string;
}

export interface PriceHistory {
  chainId: number;
  chainName: string;
  symbol: string;
  windowSeconds: number;
  changeBps: number | null;
  points: PricePoint[];
}

export function priceApiBaseUrl(): string | null {
  return SERVICES.marketPriceUrl?.replace(/\/+$/, "") ?? null;
}

/** For plotting only: a double of an e18 price. Loses precision on purpose; never use for amounts. */
export function plotPrice(e18: string): number {
  return Number(e18) / 1e18;
}

/**
 * The gap between two prices of the same token on two chains, in basis points of the first:
 * `(other − base) / base`. Positive means the other chain prices the token higher. Exact
 * arithmetic on the e18 strings; null when either side is unknown.
 */
export function spreadBps(baseE18: string | null | undefined, otherE18: string | null | undefined): number | null {
  if (!baseE18 || !otherE18) return null;
  const base = BigInt(baseE18);
  const other = BigInt(otherE18);
  if (base === 0n) return null;
  return Number(((other - base) * 10_000n) / base);
}

export interface Candle {
  /** Bucket start, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  samples: number;
}

/**
 * Candles from the API's roughly-once-a-minute samples: every sample in a `bucketSeconds`
 * window becomes one candle. Oldest first; an empty input is an empty chart, not an error.
 */
export function candlesFrom(points: readonly PricePoint[], bucketSeconds: number): Candle[] {
  if (bucketSeconds <= 0) throw new Error("bucketSeconds must be positive");
  const candles: Candle[] = [];
  for (const point of [...points].sort((a, b) => a.t - b.t)) {
    const time = Math.floor(point.t / bucketSeconds) * bucketSeconds;
    const price = plotPrice(point.e18);
    const last = candles[candles.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.samples += 1;
    } else {
      candles.push({ time, open: price, high: price, low: price, close: price, samples: 1 });
    }
  }
  return candles;
}

/** The chart's timeframes: window fetched, and the candle width that keeps candles honest at ~1 sample/min. */
export const TIMEFRAMES = [
  { id: "1h", label: "1H", windowSeconds: 3_600, bucketSeconds: 300 },
  { id: "24h", label: "24H", windowSeconds: 86_400, bucketSeconds: 1_800 },
  { id: "7d", label: "7D", windowSeconds: 7 * 86_400, bucketSeconds: 4 * 3_600 },
] as const;
export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Price API request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Every market with its live price per chain. Polls every 15 s — the API samples about once a minute. */
export function useMarkets(): DataState<MarketsResponse> {
  const base = priceApiBaseUrl();
  const query = useQuery({
    queryKey: ["market-prices", base],
    enabled: base !== null,
    refetchInterval: 15_000,
    queryFn: () => getJson<MarketsResponse>(`${base}/v1/markets`),
  });
  if (base === null) return unavailableState("No market price API configured (VITE_MARKET_PRICE_URL)");
  if (query.isPending) return { status: "loading" };
  if (query.isError) return errorState(query.error.message);
  return readyState(query.data);
}

/** One token's history on one chain for the timeframe; refetched every 15 s so the last candle moves. */
export function usePriceHistory(chainId: number, symbol: string | null, timeframe: TimeframeId): DataState<PriceHistory> {
  const base = priceApiBaseUrl();
  const frame = TIMEFRAMES.find((t) => t.id === timeframe) ?? TIMEFRAMES[1];
  const query = useQuery({
    queryKey: ["market-history", base, chainId, symbol, frame.windowSeconds],
    enabled: base !== null && symbol !== null,
    refetchInterval: 15_000,
    queryFn: () => getJson<PriceHistory>(`${base}/v1/history/${chainId}/${symbol}?window=${frame.windowSeconds}`),
  });
  if (base === null) return unavailableState("No market price API configured (VITE_MARKET_PRICE_URL)");
  if (symbol === null) return unavailableState("Pick a token");
  if (query.isPending) return { status: "loading" };
  if (query.isError) return errorState(query.error.message);
  return readyState(query.data);
}

/** The same token on every chain the API serves it, from the markets list. */
export function marketBySymbol(markets: MarketsResponse | null, symbol: string | null): Market | null {
  if (!markets || !symbol) return null;
  return markets.markets.find((m) => m.symbol === symbol) ?? null;
}
