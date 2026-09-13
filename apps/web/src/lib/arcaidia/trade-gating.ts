/**
 * WP-34 — the Trade route self-gates like every other surface. Three independent conditions;
 * each missing one is a reason the page states rather than an empty form. The chart and the
 * form gate separately: a price API that is down must not stop somebody sending a trade.
 */
import { SWAP_INFRASTRUCTURE } from "@arcaidia/domain";
import { SERVICES, TRADE_INTENTS_ENABLED } from "./config";

export interface TradeAvailability {
  /** The form: trade intents enabled and a market on the destination chain. */
  form: { available: true } | { available: false; reason: string };
  /** The chart: a price API to read from. */
  chart: { available: true } | { available: false; reason: string };
}

export function hasMarket(destinationChainId: number): boolean {
  return Object.values(SWAP_INFRASTRUCTURE).some((infra) => infra !== null && infra.chainId === destinationChainId && infra.markets.length > 0);
}

export function tradeAvailability(
  destinationChainId: number,
  overrides: { tradeIntentsEnabled?: boolean; market?: boolean; priceUrl?: string | null } = {},
): TradeAvailability {
  const enabled = overrides.tradeIntentsEnabled ?? TRADE_INTENTS_ENABLED;
  const market = overrides.market ?? hasMarket(destinationChainId);
  const priceUrl = overrides.priceUrl === undefined ? SERVICES.marketPriceUrl : overrides.priceUrl;
  const form: TradeAvailability["form"] = !enabled
    ? { available: false, reason: "Trade intents are not enabled for this deployment (VITE_TRADE_INTENTS_ENABLED)." }
    : !market
      ? { available: false, reason: "No destination market is deployed on this chain yet." }
      : { available: true };
  const chart: TradeAvailability["chart"] = priceUrl
    ? { available: true }
    : { available: false, reason: "No market price API is configured (VITE_MARKET_PRICE_URL), so there is no chart. Trades still work." };
  return { form, chart };
}
