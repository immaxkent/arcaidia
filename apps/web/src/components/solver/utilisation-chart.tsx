/**
 * Ecosystem-wide utilisation over time — one line per vault, plus one bold
 * aggregated line, next to the Solver Orb on `/console`.
 *
 * Every point is real: reconstructed from this chain's own vault event
 * history (see `use-ecosystem-utilisation.ts` / `use-vaults.ts`'s
 * `fetchVaultAnalyticsData`), never a fabricated or interpolated shape. A
 * vault with no fill history yet contributes no line at all, rather than a
 * flat guess at zero.
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { StateSection } from "@/components/data/state-views";
import type { EcosystemUtilisation } from "@/hooks/arcaidia/use-ecosystem-utilisation";
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
      if (point) lastByVault.set(vault.vaultAddress, point.bps);
      const known = lastByVault.get(vault.vaultAddress);
      if (known !== undefined) row[vault.vaultAddress] = known;
    }
    return row;
  });
}

export function UtilisationChart({ state }: { state: DataState<EcosystemUtilisation> }) {
  return (
    <section className="panel p-5">
      <h3 className="text-sm font-semibold tracking-wide text-text uppercase">
        Ecosystem utilisation over time
      </h3>
      <StateSection
        state={state}
        emptyTitle="No history yet"
        emptyNote="Utilisation appears here once a vault's history exists to chart."
        unavailableTitle="Not available yet"
        unavailableNote="Utilisation history needs at least one vault in the directory."
      >
        {(data) => {
          const rows = mergeForChart(data);
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
                    formatter={(value: number, name: string) => [formatBpsAxis(value), name]}
                    contentStyle={{
                      background: "var(--void)",
                      border: "1px solid var(--border)",
                      fontSize: 11,
                    }}
                  />
                  {data.perVault.map((vault, index) => (
                    <Line
                      key={vault.vaultAddress}
                      type="stepAfter"
                      dataKey={vault.vaultAddress}
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
            </div>
          );
        }}
      </StateSection>
    </section>
  );
}
