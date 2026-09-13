import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { floorInputText } from "./trade-form";

describe("floorInputText", () => {
  it("keeps six significant digits and never rounds a floor up", () => {
    const floor = 580_888_230_246_579n; // 0.000580888230246579 mETH
    expect(floorInputText(floor, 18)).toBe("0.000580888");
    expect(parseUnits(floorInputText(floor, 18), 18)).toBeLessThanOrEqual(floor);
    expect(floorInputText(0n, 18)).toBe("0");
    expect(floorInputText(1_234_567n, 6)).toBe("1.23456"); // seventh digit dropped, not rounded
  });
});
