import { describe, expect, it } from "vitest";
import { candlesFrom, plotPrice, spreadBps } from "./use-market-prices";

describe("market price arithmetic", () => {
  it("keeps an mPEPE-sized price exact for spreads, where a double would not", () => {
    // 0.00001 USDC per token: 1e13 as e18. A 3% higher price on the other chain.
    const base = "10000000000000";
    const other = "10300000000000";
    expect(spreadBps(base, other)).toBe(300);
    expect(spreadBps(other, base)).toBe(-291); // integer bps of the *base*, truncated toward zero
    expect(spreadBps(null, other)).toBeNull();
    expect(spreadBps("0", other)).toBeNull();
    // Plotting may lose precision; it must not lose the magnitude.
    expect(plotPrice(base)).toBeCloseTo(0.00001, 10);
  });

  it("buckets samples into candles, oldest first, and an empty series is an empty chart", () => {
    const points = [
      { t: 1_000, e18: "3000000000000000000000", display: "3000" },
      { t: 1_060, e18: "3050000000000000000000", display: "3050" },
      { t: 1_120, e18: "2990000000000000000000", display: "2990" },
      { t: 1_400, e18: "3100000000000000000000", display: "3100" },
    ];
    const candles = candlesFrom(points, 300);
    expect(candles).toEqual([
      { time: 900, open: 3000, high: 3050, low: 2990, close: 2990, samples: 3 },
      { time: 1_200, open: 3100, high: 3100, low: 3100, close: 3100, samples: 1 },
    ]);
    expect(candlesFrom([], 300)).toEqual([]);
    // Order in the input does not matter.
    expect(candlesFrom([points[3]!, points[0]!, points[2]!, points[1]!], 300)).toEqual(candles);
  });
});
