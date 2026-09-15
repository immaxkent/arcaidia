/**
 * Ecosystem-wide utilisation over time, top of `/liquidity` — one line per
 * vault across every supported chain, plus one bold aggregated line summing
 * the whole protocol's USDC balance/exposure before taking a single ratio.
 *
 * Every point is real: reconstructed from each vault's own chain's event
 * history (see `use-ecosystem-utilisation.ts` / `use-vaults.ts`'s
 * `fetchVaultAnalyticsData`), never a fabricated or interpolated shape. A
 * vault with no fill history yet contributes no line at all, rather than a
 * flat guess at zero.
 */
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { formatUsdc } from "@/lib/arcaidia/format";
import { StateSection } from "@/components/data/state-views";
import { cn } from "@/lib/utils";
import type { EcosystemUtilisation } from "@/hooks/arcaidia/use-ecosystem-utilisation";
import type { VaultAnalytics } from "@/hooks/arcaidia/use-vaults";
import type { DataState } from "@/lib/arcaidia/data-state";

const VAULT_LINE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatTime(at: number): string {
  return new Date(at * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBpsAxis(bps: number): string {
  return `${(bps / 100).toFixed(0)}%`;
}

interface MergedRow {
  at: number;
  aggregate: number;
  [vaultKey: string]: number;
}

/**
 * Recharts wants one array of rows sharing an x-axis, not several
 * independent series — merges every line's own timestamps into one sorted,
 * forward-filled table so each vault's line only starts where its own
 * history actually starts, rather than being padded with a fabricated zero.
 */
/**
 * How much history to draw, and how coarsely. Days of step data at full resolution is a
 * seismograph, not a chart: the window trims it to a readable span and the bucket collapses
 * everything inside one interval to its last value, so the shape survives and the noise does not.
 */
export const CHART_WINDOWS = [
  { id: "1h", label: "1H", seconds: 3_600, bucketSeconds: 60 },
  { id: "24h", label: "24H", seconds: 86_400, bucketSeconds: 900 },
  { id: "7d", label: "7D", seconds: 7 * 86_400, bucketSeconds: 3 * 3_600 },
  { id: "all", label: "All", seconds: Number.POSITIVE_INFINITY, bucketSeconds: 6 * 3_600 },
] as const;
export type ChartWindowId = (typeof CHART_WINDOWS)[number]["id"];

/**
 * Keep the rows inside `[now − seconds, now]`, then one row per bucket (the last in each, since
 * these are step series where the latest value is the state). The row before the window is kept
 * as the opening value so a line does not start in mid-air.
 */
export function windowRows<T extends { at: number }>(rows: readonly T[], seconds: number, bucketSeconds: number, now: number): T[] {
  if (rows.length === 0) return [];
  const from = Number.isFinite(seconds) ? now - seconds : -Infinity;
  const inside = rows.filter((r) => r.at >= from);
  if (inside.length === 0) return [];
  // One row per bucket, the last in each: these are step series, so the latest value is the state.
  const byBucket = new Map<number, T>();
  for (const row of inside) byBucket.set(Math.floor(row.at / bucketSeconds) * bucketSeconds, row);
  const out = [...byBucket.values()].sort((a, b) => a.at - b.at);
  const last = inside.at(-1)!;
  if (out.at(-1)!.at !== last.at) out.push(last); // always end on the live value
  // The row before the window becomes the opening value at the window's edge, so a line never
  // starts in mid-air; it is kept whole rather than bucketed with what follows it.
  const before = rows.filter((r) => r.at < from).at(-1);
  if (before && Number.isFinite(from) && out[0]!.at > from) out.unshift({ ...before, at: from });
  return out;
}

function mergeForChart(data: EcosystemUtilisation): MergedRow[] {
  const timestamps = [
    ...new Set([...data.aggregate.map((p) => p.at), ...data.perVault.flatMap((v) => v.points.map((p) => p.at))]),
  ].sort((a, b) => a - b);

  const lastByVault = new Map<string, number>();
  let lastAggregate = 0;

  return timestamps.map((at) => {
    const row: MergedRow = { at, aggregate: 0 };
    const aggPoint = data.aggregate.find((p) => p.at === at);
    if (aggPoint) lastAggregate = aggPoint.bps;
    row.aggregate = lastAggregate;

    for (const vault of data.perVault) {
      const point = vault.points.find((p) => p.at === at);
      if (point) lastByVault.set(vault.key, point.bps);
      const known = lastByVault.get(vault.key);
      if (known !== undefined) row[vault.key] = known;
    }
    return row;
  });
}

export function UtilisationChart({ state }: { state: DataState<EcosystemUtilisation> }) {
  const [windowId, setWindowId] = useState<ChartWindowId>("24h");
  const frame = CHART_WINDOWS.find((w) => w.id === windowId) ?? CHART_WINDOWS[1];
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-wide text-text uppercase">
          Ecosystem utilisation over time
        </h3>
        <div className="flex items-center gap-1">
          {CHART_WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setWindowId(w.id)}
              className={cn(
                "num rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                w.id === windowId ? "border-acid/60 bg-acid/15 text-acid" : "border-border text-text-dim hover:text-text",
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <StateSection
        state={state}
        emptyTitle="No history yet"
        emptyNote="Utilisation appears here once a vault's history exists to chart."
        unavailableTitle="Not available yet"
        unavailableNote="Utilisation history needs at least one vault in the directory."
      >
        {(data) => {
          const all = mergeForChart(data);
          const rows = windowRows(all, frame.seconds, frame.bucketSeconds, Math.floor(Date.now() / 1000));
          if (rows.length === 0) {
            return (
              <p className="mt-3 text-xs text-text-dim">
                Nothing in the last {frame.label.toLowerCase()} — pick a longer window.
              </p>
            );
          }
          return (
            <div className="mt-3 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="at"
                    tickFormatter={formatTime}
                    stroke="var(--text-dim)"
                    tick={{ fontSize: 10 }}
                    minTickGap={40}
                  />
                  <YAxis
                    tickFormatter={formatBpsAxis}
                    stroke="var(--text-dim)"
                    tick={{ fontSize: 10 }}
                    width={40}
                  />
                  <Tooltip
                    labelFormatter={(at: number) => formatTime(at)}
                    formatter={(value: number, name: string) => [formatBpsAxis(value), name]}
                    contentStyle={{
                      background: "var(--void)",
                      border: "1px solid var(--border)",
                      fontSize: 11,
                    }}
                  />
                  {data.perVault.map((vault, index) => (
                    <Line
                      key={vault.key}
                      type="stepAfter"
                      dataKey={vault.key}
                      name={vault.label}
                      stroke={VAULT_LINE_COLORS[index % VAULT_LINE_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls={false}
                    />
                  ))}
                  <Line
                    type="stepAfter"
                    dataKey="aggregate"
                    name="Ecosystem aggregate"
                    stroke="var(--acid)"
                    strokeWidth={2.5}
                    strokeDasharray="4 2"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="num mt-1 text-[10px] text-text-dim">
                {rows.length} of {all.length} points · one every {frame.bucketSeconds >= 3_600 ? `${frame.bucketSeconds / 3_600}h` : `${frame.bucketSeconds / 60}m`}
              </p>
            </div>
          );
        }}
      </StateSection>
    </section>
  );
}

/**
 * One vault's own utilisation over time — the Solver Console's per-vault
 * detail view (`/console`), where every other figure on the page is already
 * scoped to whichever vault is selected. The ecosystem-wide, every-vault
 * view above this one belongs on `/liquidity` instead, where "the market"
 * rather than "this one vault" is the subject.
 */
export function VaultUtilisationChart({ state }: { state: DataState<VaultAnalytics> }) {
  return (
    <section className="panel p-5">
      <h3 className="text-sm font-semibold tracking-wide text-text uppercase">
        Vault utilisation over time
      </h3>
      <StateSection
        state={state}
        emptyTitle="No history yet"
        emptyNote="Utilisation appears here once this vault has deposit, fill or reimbursement history."
        unavailableTitle="Not available yet"
        unavailableNote="Utilisation history needs the indexer connected for this chain."
      >
        {(data) => {
          const rows = data.utilisationSeries;
          if (rows.length === 0) {
            return <p className="mt-3 text-xs text-text-dim">No history yet.</p>;
          }
          return (
            <div className="mt-3 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="at"
                    tickFormatter={formatTime}
                    stroke="var(--text-dim)"
                    tick={{ fontSize: 10 }}
                    minTickGap={40}
                  />
                  <YAxis
                    tickFormatter={formatBpsAxis}
                    stroke="var(--text-dim)"
                    tick={{ fontSize: 10 }}
                    width={40}
                  />
                  <Tooltip
                    labelFormatter={(at: number) => formatTime(at)}
                    formatter={(value: number) => [formatBpsAxis(value), "Utilisation"]}
                    contentStyle={{
                      background: "var(--void)",
                      border: "1px solid var(--border)",
                      fontSize: 11,
                    }}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="bps"
                    name="Utilisation"
                    stroke="var(--acid)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        }}
      </StateSection>
    </section>
  );
}

/**
 * The vault's posted fee tier over time (D7) — derived point-for-point from the utilisation
 * series above through the vault's own immutable policy, so the two charts read together:
 * the tier steps exactly where utilisation crosses a threshold.
 */
export function VaultFeeTierChart({ state }: { state: DataState<VaultAnalytics> }) {
  return (
    <section className="panel p-5">
      <h3 className="text-sm font-semibold tracking-wide text-text uppercase">Posted fee tier over time</h3>
      <StateSection
        state={state}
        emptyTitle="No history yet"
        emptyNote="The fee tier appears here once this vault has history and its policy is readable."
        unavailableTitle="Not available yet"
        unavailableNote="Fee history needs the indexer connected and the vault's policy readable from the chain."
      >
        {(data) => {
          const rows = data.feeTierSeries;
          if (rows.length === 0) {
            return <p className="mt-3 text-xs text-text-dim">No fee history yet.</p>;
          }
          return (
            <div className="mt-3 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="at"
                    tickFormatter={formatTime}
                    stroke="var(--text-dim)"
                    tick={{ fontSize: 10 }}
                    minTickGap={40}
                  />
                  <YAxis
                    tickFormatter={(bps: number) => `${bps} bps`}
                    stroke="var(--text-dim)"
                    tick={{ fontSize: 10 }}
                    width={56}
                  />
                  <Tooltip
                    labelFormatter={(at: number) => formatTime(at)}
                    formatter={(value: number) => [`${value} bps`, "Posted tier"]}
                    contentStyle={{
                      background: "var(--void)",
                      border: "1px solid var(--border)",
                      fontSize: 11,
                    }}
                  />
                  <Line type="stepAfter" dataKey="bps" name="Posted tier" stroke="var(--gold-glow, var(--acid))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        }}
      </StateSection>
    </section>
  );
}

/** Cumulative USDC series (6-dp bigints) as Recharts rows — `usdc` is whole USDC for the axis. */
function usdcRows(rows: ReadonlyArray<{ at: number; value: bigint }>): Array<{ at: number; usdc: number; raw: string }> {
  return rows.map((p) => ({ at: p.at, usdc: Number(p.value) / 1_000_000, raw: p.value.toString() }));
}

/** Axis ticks at the scale the series actually reaches — a 0.05 USDC fee total is not five zeros. */
function formatUsdcAxis(usdc: number): string {
  if (usdc >= 1000) return `${(usdc / 1000).toFixed(usdc >= 10_000 ? 0 : 1)}k`;
  if (usdc >= 10) return usdc.toFixed(0);
  if (usdc >= 1) return usdc.toFixed(1);
  return usdc === 0 ? "0" : usdc.toFixed(3).replace(/0+$/, "");
}

/**
 * One vault's cumulative history as a stepped area — the `/liquidity` vault detail's two
 * history charts. Every point is a real event replayed from the vault's own indexed logs
 * (`fetchVaultAnalyticsData`): volume steps on each `FastFilled`, fees on each
 * `ReimbursementRecorded` (the amount settlement returned above what was advanced, gross
 * of the protocol share). Never interpolated — a vault with no events draws nothing.
 */
function VaultUsdcHistoryChart({
  title,
  series,
  label,
  stroke,
}: {
  title: string;
  series: ReadonlyArray<{ at: number; value: bigint }>;
  label: string;
  stroke: string;
}) {
  const rows = usdcRows(series);
  const gradientId = `vault-history-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="instrument p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-text-dim">{title}</p>
      <div className="mt-2 h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="at" tickFormatter={formatTime} stroke="var(--text-dim)" tick={{ fontSize: 10 }} minTickGap={40} />
            <YAxis tickFormatter={formatUsdcAxis} stroke="var(--text-dim)" tick={{ fontSize: 10 }} width={44} />
            <Tooltip
              labelFormatter={(at: number) => formatTime(at)}
              formatter={(_value: number, _name: string, item: { payload?: { raw?: string } }) => [
                `${formatUsdc(BigInt(item.payload?.raw ?? "0"))} USDC`,
                label,
              ]}
              contentStyle={{ background: "var(--void)", border: "1px solid var(--border)", fontSize: 11 }}
            />
            <Area type="stepAfter" dataKey="usdc" name={label} stroke={stroke} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Cumulative fill volume (`outputAmount` advanced, per `FastFilled`). */
export function VaultVolumeChart({ series }: { series: ReadonlyArray<{ at: number; value: bigint }> }) {
  return <VaultUsdcHistoryChart title="Volume history — cumulative USDC advanced" series={series} label="Cumulative volume" stroke="var(--acid)" />;
}

/** Cumulative fees returned by canonical settlement (`amountReceived − exposureCleared`, per `ReimbursementRecorded`). */
export function VaultFeeChart({ series }: { series: ReadonlyArray<{ at: number; value: bigint }> }) {
  return <VaultUsdcHistoryChart title="Fee history — cumulative USDC earned" series={series} label="Cumulative fees" stroke="var(--gold-glow, var(--acid))" />;
}
