import { CHAINS } from "@/lib/arcaidia/types";
import type { FillRow, OperatorType, VaultStatus } from "@/lib/arcaidia/types";
import { formatBps, formatDuration, formatUsdc, truncateAddress } from "@/lib/arcaidia/format";
import { TimeValue } from "@/components/site/time-value";
import { explorerTxUrl } from "@/lib/arcaidia/config";
import { NOT_AVAILABLE, type DataState } from "@/lib/arcaidia/data-state";
import { StateSection } from "@/components/data/state-views";


export function OperatorBadge({ type }: { type: OperatorType }) {
  const house = type === "HOUSE";
  return (
    <span
      className={`num rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        house ? "border-gold/50 bg-gold/10 text-gold-glow" : "border-acid/50 bg-acid/10 text-acid"
      }`}
    >
      {house ? "House" : "Independent"}
    </span>
  );
}

const STATUS_STYLE: Record<VaultStatus, string> = {
  ACTIVE: "border-success/50 bg-success/10 text-success",
  PAUSED: "border-warning/50 bg-warning/10 text-warning",
  WINDING_DOWN: "border-border bg-surface-raised text-text-dim",
};

const STATUS_LABEL: Record<VaultStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  WINDING_DOWN: "Winding down",
};

export function StatusChip({ status }: { status: VaultStatus | null }) {
  if (!status) {
    return (
      <span
        title="Vault status not readable yet"
        className="num rounded-sm border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-dim/70"
      >
        {NOT_AVAILABLE}
      </span>
    );
  }
  return (
    <span
      className={`num rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function SettlementChip({ status }: { status: FillRow["canonicalStatus"] }) {
  const settled = status === "SETTLED";
  return (
    <span
      className={`num rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        settled ? "border-gold/50 bg-gold/10 text-gold-glow" : "border-electric/50 bg-electric/10 text-electric-glow"
      }`}
    >
      {settled ? "Reimbursed" : "Awaiting CCTP"}
    </span>
  );
}

export function ChainBadge({ chainId }: { chainId: number }) {
  return (
    <span className="num rounded-sm border border-brass/70 bg-void/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-dim">
      {CHAINS[chainId]?.short ?? chainId}
    </span>
  );
}

export function UtilisationMeter({ bps, label = true }: { bps: number | null; label?: boolean }) {
  const pct = bps === null ? 0 : Math.min(100, bps / 100);
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full border border-border bg-void">
        <span
          style={{ width: `${pct}%` }}
          className="block h-full bg-linear-to-r from-electric to-acid"
        />
      </div>
      {label ? (
        <p className="num mt-1 text-[11px] text-text-dim">
          {bps === null ? `${NOT_AVAILABLE} utilised` : `${formatBps(bps)} utilised`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * HANDOFF — realised fills table. Driven entirely by a DataState from
 * useVaultFills (The Graph). It starts empty and never renders example rows.
 */
export function FillsTable({ state }: { state: DataState<FillRow[]> }) {
  return (
    <StateSection
      state={state}
      emptyTitle="No fills yet"
      emptyNote="Winning fills appear here once this vault funds an intent."
      unavailableTitle="No fills yet"
      unavailableNote="Fill history comes from the indexer, which is not connected yet."
    >
      {(fills) => <FillsTableBody fills={fills} />}
    </StateSection>
  );
}

function FillsTableBody({ fills }: { fills: FillRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">Intents this vault won and funded</caption>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-text-dim">
            <th className="pb-2 font-medium">Intent</th>
            <th className="pb-2 font-medium">Route</th>
            <th className="pb-2 font-medium">Advanced</th>
            <th className="pb-2 font-medium">Fee earned</th>
            <th className="pb-2 font-medium">Fast fill</th>
            <th className="pb-2 font-medium">Canonical</th>
            <th className="pb-2 font-medium">Latency</th>
            <th className="pb-2 font-medium">Tx</th>
          </tr>
        </thead>
        <tbody>
          {fills.map((f) => (
            <tr key={f.intentId} className="border-t border-border/60">
              <td className="num py-2.5 text-text-dim">{truncateAddress(f.intentId, 8, 4)}</td>
              <td className="py-2.5">
                <span className="flex items-center gap-1.5">
                  <ChainBadge chainId={f.sourceChainId} />
                  <span className="text-text-dim">→</span>
                  <ChainBadge chainId={f.destinationChainId} />
                </span>
              </td>
              <td className="num py-2.5 text-text">{formatUsdc(f.amountAdvanced)}</td>
              <td className="num py-2.5 text-acid">{formatUsdc(f.feeAmount)}</td>
              <td className="num py-2.5 text-text-dim">
                <TimeValue at={f.fastFillTimestamp} />
              </td>
              <td className="py-2.5">
                <SettlementChip status={f.canonicalStatus} />
              </td>
              <td className="num py-2.5 text-text-dim">
                {f.settlementLatencySeconds === null ? "—" : formatDuration(f.settlementLatencySeconds)}
              </td>
              <td className="num py-2.5">
                <span className="flex gap-2">
                  <ExplorerLink chainId={f.sourceChainId} txHash={f.sourceTxHash} label="src" />
                  <ExplorerLink chainId={f.destinationChainId} txHash={f.destinationTxHash} label="dst" />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExplorerLink({ chainId, txHash, label }: { chainId: number; txHash: string; label: string }) {
  const href = explorerTxUrl(chainId, txHash);
  if (!href) return <span className="text-text-dim/70">{NOT_AVAILABLE}</span>;
  return (
    <a className="text-electric-glow hover:text-acid" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}
