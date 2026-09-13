import { useEffect, useMemo, useRef, useState } from "react";
import { CHAINS } from "@/lib/arcaidia/types";
import { NOT_AVAILABLE, type DataState } from "@/lib/arcaidia/data-state";
import { candlesFrom, plotPrice, spreadBps, TIMEFRAMES, type MarketOnChain, type PriceHistory, type TimeframeId } from "@/hooks/arcaidia/use-market-prices";
import { cn } from "@/lib/utils";

/**
 * WP-34 — the Trade page's centrepiece: candlesticks of the token on the destination chain,
 * built from the price API's samples, with the same token's price on the origin chain drawn as
 * a line on the same axis and the live spread between them. Every number here is the API's own
 * sample or null; the chart price is context, never what the user receives.
 *
 * `lightweight-charts` is loaded in the browser only (the route is server-rendered first).
 */
/** Exponential moving average over `span` points; the first point seeds it. Pure, for the origin trend line. */
export function emaOf(points: ReadonlyArray<{ time: number; value: number }>, span: number): Array<{ time: number; value: number }> {
  if (points.length === 0) return [];
  const k = 2 / (span + 1);
  let ema = points[0]!.value;
  return points.map((p, i) => {
    ema = i === 0 ? p.value : p.value * k + ema * (1 - k);
    return { time: p.time, value: ema };
  });
}

export function PriceChart({
  symbol,
  destinationChainId,
  originChainId,
  destinationHistory,
  originHistory,
  destinationSpot,
  originSpot,
  timeframe,
  onTimeframe,
}: {
  symbol: string | null;
  destinationChainId: number;
  originChainId: number;
  destinationHistory: DataState<PriceHistory>;
  originHistory: DataState<PriceHistory>;
  destinationSpot: MarketOnChain | null;
  originSpot: MarketOnChain | null;
  timeframe: TimeframeId;
  onTimeframe: (id: TimeframeId) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<{ chart: unknown; candles: unknown; line: unknown; trend: unknown } | null>(null);
  const [ready, setReady] = useState(false);
  const frame = TIMEFRAMES.find((t) => t.id === timeframe) ?? TIMEFRAMES[1];
  const candles = useMemo(
    () => (destinationHistory.status === "ready" ? candlesFrom(destinationHistory.data.points, frame.bucketSeconds) : []),
    [destinationHistory, frame.bucketSeconds],
  );
  const originLine = useMemo(
    () =>
      originHistory.status === "ready"
        ? candlesFrom(originHistory.data.points, frame.bucketSeconds).map((c) => ({ time: c.time, value: c.close }))
        : [],
    [originHistory, frame.bucketSeconds],
  );
  const originTrend = useMemo(() => emaOf(originLine, 12), [originLine]);
  const spread = spreadBps(originSpot?.price?.e18, destinationSpot?.price?.e18);

  useEffect(() => {
    let disposed = false;
    const el = container.current;
    if (!el) return;
    void import("lightweight-charts").then((lib) => {
      if (disposed || !el) return;
      const css = getComputedStyle(document.documentElement);
      const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      const chart = lib.createChart(el, {
        autoSize: true,
        layout: { background: { type: lib.ColorType.Solid, color: "transparent" }, textColor: token("--color-muted-foreground", "#9aa3b2"), fontFamily: "inherit" },
        grid: { vertLines: { color: "rgba(128,128,128,0.08)" }, horzLines: { color: "rgba(128,128,128,0.08)" } },
        crosshair: { mode: lib.CrosshairMode.Normal },
        rightPriceScale: { borderColor: token("--color-border", "#333") },
        timeScale: { borderColor: token("--color-border", "#333"), timeVisible: true, secondsVisible: false },
        localization: { priceFormatter: (p: number) => (p >= 1 ? p.toLocaleString(undefined, { maximumFractionDigits: 2 }) : p.toPrecision(4)) },
      });
      const candlesSeries = chart.addSeries(lib.CandlestickSeries, {
        upColor: token("--color-acid", "#b8ff3c"),
        downColor: token("--color-danger", "#ff5c5c"),
        borderUpColor: token("--color-acid", "#b8ff3c"),
        borderDownColor: token("--color-danger", "#ff5c5c"),
        wickUpColor: token("--color-acid", "#b8ff3c"),
        wickDownColor: token("--color-danger", "#ff5c5c"),
        priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
      });
      const line = chart.addSeries(lib.LineSeries, {
        color: token("--color-electric-glow", "#7cc4ff"),
        lineWidth: 3,
        priceLineVisible: true,
        lastValueVisible: true,
        priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
      });
      // The origin chain's trend: a 12-bucket exponential moving average, dashed.
      const trend = chart.addSeries(lib.LineSeries, {
        color: token("--color-gold-glow", "#ffd36b"),
        lineWidth: 2,
        lineStyle: lib.LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
      });
      chartRef.current = { chart, candles: candlesSeries, line, trend };
      setReady(true);
    });
    return () => {
      disposed = true;
      const current = chartRef.current as { chart: { remove(): void } } | null;
      current?.chart.remove();
      chartRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const current = chartRef.current as {
      chart: { timeScale(): { fitContent(): void } };
      candles: { setData(d: unknown[]): void };
      line: { setData(d: unknown[]): void };
      trend: { setData(d: unknown[]): void };
    } | null;
    if (!ready || !current) return;
    current.candles.setData(candles);
    current.line.setData(originLine);
    current.trend.setData(originTrend);
    current.chart.timeScale().fitContent();
  }, [ready, candles, originLine, originTrend]);

  const change = destinationHistory.status === "ready" ? destinationHistory.data.changeBps : null;
  const destinationName = CHAINS[destinationChainId]?.short ?? String(destinationChainId);
  const originName = CHAINS[originChainId]?.short ?? String(originChainId);

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl uppercase text-newsprint">{symbol ?? "Pick a token"}</h2>
          <p className="num mt-0.5 text-xs text-text-dim">
            {symbol ? `${symbol} / USDC on ${destinationName}` : "The destination chain's price, live"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTimeframe(t.id)}
              className={cn(
                "num rounded-md border px-2.5 py-1 text-xs transition-colors",
                t.id === timeframe ? "border-acid/60 bg-acid/15 text-acid" : "border-border text-text-dim hover:text-text",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <dl className="num mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-text-dim">{destinationName} price</dt>
          <dd className="text-lg text-text">{destinationSpot?.price ? destinationSpot.price.display : NOT_AVAILABLE}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-text-dim">{originName} price</dt>
          <dd className="text-lg text-electric-glow">{originSpot?.price ? originSpot.price.display : NOT_AVAILABLE}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-text-dim">Spread {originName} → {destinationName}</dt>
          <dd className={cn("text-lg", spread === null ? "text-text-dim" : spread > 0 ? "text-acid" : "text-warning")}>
            {spread === null ? NOT_AVAILABLE : `${spread > 0 ? "+" : ""}${(spread / 100).toFixed(2)}%`}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-text-dim">Change · {frame.label}</dt>
          <dd className={cn("text-lg", change === null ? "text-text-dim" : change >= 0 ? "text-acid" : "text-warning")}>
            {change === null ? NOT_AVAILABLE : `${change >= 0 ? "+" : ""}${(change / 100).toFixed(2)}%`}
          </dd>
        </div>
      </dl>

      <div className="relative mt-3 h-[360px] w-full">
        <div ref={container} className="absolute inset-0" />
        {destinationHistory.status === "loading" ? (
          <p className="absolute inset-0 grid place-items-center text-xs text-text-dim">Loading price history…</p>
        ) : destinationHistory.status === "error" ? (
          <p className="absolute inset-0 grid place-items-center text-xs text-warning">{destinationHistory.error ?? "Price history unavailable"}</p>
        ) : destinationHistory.status === "ready" && candles.length === 0 ? (
          <p className="absolute inset-0 grid place-items-center text-xs text-text-dim">No samples in this window yet — the market may have just been deployed.</p>
        ) : null}
      </div>

      <div className="num mt-2 flex flex-wrap items-center gap-4 text-[11px] text-text-dim">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-sm bg-acid" aria-hidden="true" /> {destinationName} candles, {frame.bucketSeconds / 60} min each
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-electric-glow" aria-hidden="true" /> {originName} price
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-gold-glow" aria-hidden="true" /> {originName} trend (12-candle average)
        </span>
        <span className="ml-auto">
          Sampled about once a minute by the market's price API
          {destinationSpot?.sampledAt ? ` · last ${new Date(destinationSpot.sampledAt * 1000).toLocaleTimeString()}` : ""}
        </span>
      </div>
      {destinationSpot?.price ? (
        <p className="num mt-1 text-[11px] text-text-dim">
          Pool reserves on {destinationName}: {(Number(destinationSpot.price.usdcReserve) / 1e6).toFixed(2)} USDC ·{" "}
          {plotPrice(destinationSpot.price.tokenReserve).toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}. A shallow pool: a 1 USDC trade moves the price about 2.5%.
        </p>
      ) : null}
    </section>
  );
}
