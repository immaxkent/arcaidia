import { describe, expect, it } from "vitest";
import { targetMinOutFrom } from "./use-swap-quote";

describe("targetMinOutFrom", () => {
  it("is the adapter's quote less the slippage tolerance, never the chart price", () => {
    const quoted = 12_345_678_901_234_567_890n; // 12.34… mETH-units at 18 decimals
    expect(targetMinOutFrom(quoted, 50)).toBe((quoted * 9_950n) / 10_000n);
    expect(targetMinOutFrom(quoted, 0)).toBe(quoted);
    expect(targetMinOutFrom(quoted, 10_000)).toBe(0n);
    expect(() => targetMinOutFrom(quoted, 10_001)).toThrow();
  });
});
