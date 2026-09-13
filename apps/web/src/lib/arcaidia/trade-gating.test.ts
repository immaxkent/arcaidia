import { describe, expect, it } from "vitest";
import { tradeAvailability } from "./trade-gating";

describe("tradeAvailability", () => {
  const ARC = 5_042_002;
  it("gates the form on the flag and the market, and the chart on the price API, independently", () => {
    const all = tradeAvailability(ARC, { tradeIntentsEnabled: true, market: true, priceUrl: "https://prices.example" });
    expect(all.form.available).toBe(true);
    expect(all.chart.available).toBe(true);

    const noFlag = tradeAvailability(ARC, { tradeIntentsEnabled: false, market: true, priceUrl: "https://prices.example" });
    expect(noFlag.form).toMatchObject({ available: false, reason: expect.stringContaining("VITE_TRADE_INTENTS_ENABLED") });
    expect(noFlag.chart.available).toBe(true);

    const noMarket = tradeAvailability(ARC, { tradeIntentsEnabled: true, market: false, priceUrl: "https://prices.example" });
    expect(noMarket.form).toMatchObject({ available: false, reason: expect.stringContaining("market") });

    const noPrices = tradeAvailability(ARC, { tradeIntentsEnabled: true, market: true, priceUrl: null });
    expect(noPrices.form.available).toBe(true);
    expect(noPrices.chart).toMatchObject({ available: false, reason: expect.stringContaining("VITE_MARKET_PRICE_URL") });
  });
});
