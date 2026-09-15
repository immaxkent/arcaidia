import { describe, expect, it } from "vitest";
import { CHART_WINDOWS, windowRows } from "./utilisation-chart";

const NOW = 1_800_000_000;
const rows = (times: number[]) => times.map((at, i) => ({ at, bps: i }));

describe("windowRows", () => {
  it("keeps only the window, one row per bucket, and always ends on the live value", () => {
    const series = rows([NOW - 7_200, NOW - 3_500, NOW - 3_400, NOW - 1_800, NOW - 60, NOW - 10]);
    const out = windowRows(series, 3_600, 900, NOW);
    // the row before the window opens the line, at the window's edge
    expect(out[0]!.at).toBe(NOW - 3_600);
    expect(out.at(-1)!.at).toBe(NOW - 10);
    // one per 15-minute bucket, plus the live tail: far fewer than the raw series
    expect(out.length).toBeLessThan(series.length);
    expect(out.map((r) => r.at)).toEqual([...out.map((r) => r.at)].sort((a, b) => a - b));
  });

  it("collapses a dense series hard on a long window", () => {
    const dense = rows(Array.from({ length: 2_000 }, (_, i) => NOW - 7 * 86_400 + i * 300));
    const week = CHART_WINDOWS.find((w) => w.id === "7d")!;
    const out = windowRows(dense, week.seconds, week.bucketSeconds, NOW);
    expect(out.length).toBeLessThanOrEqual(7 * 8 + 2); // ~one every 3h over a week
    expect(out.at(-1)!.at).toBe(dense.at(-1)!.at);
  });

  it("an 'all' window keeps everything from the start, still bucketed", () => {
    const series = rows([NOW - 30 * 86_400, NOW - 15 * 86_400, NOW - 60]);
    const all = CHART_WINDOWS.find((w) => w.id === "all")!;
    expect(windowRows(series, all.seconds, all.bucketSeconds, NOW)).toHaveLength(3);
    expect(windowRows([], 3_600, 60, NOW)).toEqual([]);
  });
});
