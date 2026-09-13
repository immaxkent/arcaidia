import { describe, expect, it } from "vitest";
import { emaOf } from "./price-chart";

describe("emaOf", () => {
  it("seeds with the first point and smooths toward later ones; empty stays empty", () => {
    expect(emaOf([], 12)).toEqual([]);
    const out = emaOf([{ time: 1, value: 100 }, { time: 2, value: 200 }, { time: 3, value: 200 }], 3);
    expect(out[0]).toEqual({ time: 1, value: 100 });
    expect(out[1]!.value).toBeCloseTo(150);
    expect(out[2]!.value).toBeGreaterThan(out[1]!.value);
    expect(out[2]!.value).toBeLessThan(200);
  });
});
