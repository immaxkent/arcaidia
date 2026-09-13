/**
 * Real intent history — the connected wallet's own (`IntentHistoryPanel`),
 * and every transfer across the market (`AllTransfersPanel`).
 *
 * SOURCE: useIntentHistory / useAllTransfers (Arcaidia's shared Nest indexer,
 * both chains, client-side join — see those hooks' own docs for why the join
 * can't happen inside a single query). `fastStatus`/`canonicalStatus` are the
 * real per-intent facts — the same two-track model the rest of the app holds
 * to, never merged into one boolean.
 */
import { useState } from "react";
import { toast } from "sonner";
import { ETHEREUM_SEPOLIA, ARC_TESTNET, type Address, type Hex } from "@/lib/arcaidia/types";
import { formatDuration, formatUsdc, truncateAddress } from "@/lib/arcaidia/format";
import { explorerTxUrl } from "@/lib/arcaidia/config";
import type { DataState } from "@/lib/arcaidia/data-state";
import { StateSection } from "@/components/data/state-views";
import { ChainBadge } from "@/components/vaults/vault-bits";
import { TimeValue } from "@/components/site/time-value";
import { useAllTransfers, useIntentHistory, type IntentHistoryRow } from "@/hooks/arcaidia/use-intent-history";
import { cn } from "@/lib/utils";
import { marketToken } from "@/hooks/arcaidia/use-swap-quote";
import { formatTokenAmount } from "@/components/trade/trade-form";

/**
 * Click copies the intent id; Cmd/Ctrl-click opens the *creation* tx (the
 * only real transaction an intent id itself corresponds to) on the source
 * chain's own explorer — which chain that is depends on the intent, not a
 * fixed choice. A real `<a href>` so Cmd/Ctrl-click gets the browser's own
 * open-in-new-tab behaviour for free; the plain-click path intercepts it.
 */
function IntentLink({
  intentId,
  sourceChainId,
  sourceTxHash,
}: {
  intentId: Hex;
  sourceChainId: number;
  sourceTxHash: Hex | undefined;
}) {
  const href = sourceTxHash ? explorerTxUrl(sourceChainId, sourceTxHash) : null;
  return (
    <a
      href={href ?? undefined}
      target="_blank"
      rel="noreferrer"
      title={
        href
          ? `${intentId}\nClick to copy · Cmd/Ctrl-click to view the creation tx`
          : intentId
      }
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        navigator.clipboard?.writeText(intentId);
        toast.success("Copied", { description: truncateAddress(intentId, 10, 8) });
      }}
      className="num cursor-pointer text-text-dim transition-colors hover:text-electric-glow"
    >
      {truncateAddress(intentId, 8, 4)}
    </a>
  );
}

/**
 * How the recipient actually got paid, and how long it took — one derived
 * read of the two independent facts (fastStatus, canonicalStatus) the rest
 * of the app holds apart. Not a third status field: "direct" is just what
 * `fastStatus: PENDING` + `canonicalStatus: SETTLED` *means* — the solver
 * never fast-filled it, canonical CCTP paid the recipient on its own. Calling
 * that "pending fill" reads as stuck when it's actually finished, just via
 * the slower, always-guaranteed path. Given its own light-blue styling,
 * distinct from both "Fast filled" (acid) and "Settled" (gold) — sharing
 * gold with the canonical chip read as one repeated tag instead of two
 * separate facts about the same row.
 */
type Resolution =
  | { kind: "FAST"; seconds: number | null }
  | { kind: "DIRECT"; seconds: number | null }
  | { kind: "PENDING" };

function resolutionFor(row: IntentHistoryRow): Resolution {
  const { settlement, intent } = row;
  if (settlement.fastStatus === "FAST_FILLED") {
    const seconds =
      settlement.fastFilledAt !== undefined ? settlement.fastFilledAt - intent.createdAt : null;
    return { kind: "FAST", seconds };
  }
  if (settlement.canonicalStatus === "SETTLED") {
    const seconds = settlement.settledAt !== undefined ? settlement.settledAt - intent.createdAt : null;
    return { kind: "DIRECT", seconds };
  }
  return { kind: "PENDING" };
}

/** WP-34: a trade intent's own terms, exactly as written on chain and indexed: the token and the floor. */
function TradeTerms({ row }: { row: IntentHistoryRow }) {
  const tokenOut = row.intent.tokenOut;
  if (!tokenOut || /^0x0{40}$/i.test(tokenOut)) return null;
  const token = marketToken(row.intent.destinationChainId, tokenOut);
  const symbol = token?.tokenOut.symbol ?? truncateAddress(tokenOut);
  const floor = token ? formatTokenAmount(row.intent.targetMinOut, token.tokenOut.decimals) : row.intent.targetMinOut.toString();
  return (
    <span className="block text-[11px] text-text-dim" title="tokenOut and targetMinOut, from the intent itself">
      → ≥ {floor} {symbol}
    </span>
  );
}

function FillChip({ resolution, row }: { resolution: Resolution; row?: IntentHistoryRow }) {
  // WP-34: a fast fill of a trade intent either delivered the token (SWAP) or fell back to USDC.
  if (resolution.kind === "FAST" && row?.deliveredVia === "SWAP") {
    const token = marketToken(row.intent.destinationChainId, row.intent.tokenOut ?? null);
    return (
      <span className="num rounded-sm border border-acid/50 bg-acid/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-acid" title="Fast filled and swapped into the requested token by the vault">
        Swapped → {token?.tokenOut.symbol ?? "token"}
        {row.amountOut !== null && token ? ` ${formatTokenAmount(row.amountOut, token.tokenOut.decimals)}` : ""}
      </span>
    );
  }
  if (resolution.kind === "FAST" && row?.deliveredVia === "SWAP_FALLBACK") {
    return (
      <span className="num rounded-sm border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning" title="Fast filled, but the swap could not meet the floor — USDC was delivered instead">
        USDC fallback
      </span>
    );
  }
  if (resolution.kind === "PENDING") {
    return (
      <span className="num rounded-sm border border-text-dim/40 bg-text-dim/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
        Pending fill
      </span>
    );
  }
  const isFast = resolution.kind === "FAST";
  return (
    <span
      className={cn(
        "num rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        isFast
          ? "border-acid/50 bg-acid/10 text-acid"
          : "border-electric-glow/50 bg-electric-glow/10 text-electric-glow",
      )}
      title={isFast ? "Paid by the solver ahead of CCTP" : "No fast fill — paid directly once CCTP completed"}
    >
      {isFast ? "Fast filled" : "Direct fill"}
    </span>
  );
}

function CanonicalStatusChip({ status }: { status: "PENDING" | "SETTLED" }) {
  const settled = status === "SETTLED";
  return (
    <span
      className={cn(
        "num rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        settled
          ? "border-gold/50 bg-gold/10 text-gold-glow"
          : "border-electric/50 bg-electric/10 text-electric-glow",
      )}
    >
      {settled ? "Settled" : "Awaiting CCTP"}
    </span>
  );
}

/** WP-34: which intents a history panel lists — plain USDC transfers, trades (a token out), or both. */
export type HistoryKind = "transfers" | "trades" | "all";

function isTrade(row: IntentHistoryRow): boolean {
  return Boolean(row.intent.tokenOut) && !/^0x0{40}$/i.test(row.intent.tokenOut);
}

function filterKind(history: DataState<IntentHistoryRow[]>, kind: HistoryKind): DataState<IntentHistoryRow[]> {
  if (history.status !== "ready" || kind === "all") return history;
  return { status: "ready", data: history.data.filter((row) => (kind === "trades" ? isTrade(row) : !isTrade(row))) };
}

const NOUN: Record<HistoryKind, { one: string; many: string }> = {
  transfers: { one: "transfer", many: "transfers" },
  trades: { one: "trade", many: "trades" },
  all: { one: "transfer", many: "transfers" },
};

export function IntentHistoryPanel({ owner, kind = "all" }: { owner: Address | null; kind?: HistoryKind }) {
  const history = filterKind(useIntentHistory(owner, [ETHEREUM_SEPOLIA, ARC_TESTNET]), kind);
  const noun = NOUN[kind];
  return (
    <IntentHistoryTable
      title={`Your ${noun.many}`}
      history={history}
      emptyTitle={`No ${noun.many} yet`}
      emptyNote={`Every ${noun.one} you create appears here, live — the fast advance and the canonical settlement, tracked separately.`}
      unavailableTitle={`No ${noun.many} yet`}
      unavailableNote={`Connect a wallet to see your ${noun.one} history.`}
    />
  );
}

/**
 * Every transfer across the whole market, no ownership filter — a public,
 * view-only feed. Same table, same live join, deliberately no "connect a
 * wallet" gate: unlike `IntentHistoryPanel`, nothing here ever depended on
 * who's connected.
 */
export function AllTransfersPanel({ kind = "all" }: { kind?: HistoryKind }) {
  const history = filterKind(useAllTransfers([ETHEREUM_SEPOLIA, ARC_TESTNET]), kind);
  const noun = NOUN[kind];
  return (
    <IntentHistoryTable
      title={`All ${noun.many}`}
      history={history}
      emptyTitle={`No ${noun.many} yet`}
      emptyNote={`Every ${noun.one} across the market appears here, live — the fast advance and the canonical settlement, tracked separately.`}
      unavailableTitle={`No ${noun.many} yet`}
      unavailableNote="Indexer not connected."
    />
  );
}

const PAGE_SIZE = 20;

function IntentHistoryTable({
  title,
  history,
  emptyTitle,
  emptyNote,
  unavailableTitle,
  unavailableNote,
}: {
  title: string;
  history: DataState<IntentHistoryRow[]>;
  emptyTitle: string;
  emptyNote: string;
  unavailableTitle: string;
  unavailableNote: string;
}) {
  const [page, setPage] = useState(0);
  const total = history.status === "ready" ? history.data.length : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-wide text-text uppercase">{title}</h3>
        {total > PAGE_SIZE ? (
          <span className="num flex items-center gap-2 text-[11px] text-text-dim">
            {current * PAGE_SIZE + 1}–{Math.min(total, (current + 1) * PAGE_SIZE)} of {total}
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40">‹</button>
            <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40">›</button>
          </span>
        ) : null}
      </div>
      <StateSection
        state={history}
        emptyTitle={emptyTitle}
        emptyNote={emptyNote}
        unavailableTitle={unavailableTitle}
        unavailableNote={unavailableNote}
      >
        {(rows) => (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">{title}, both directions</caption>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th className="pb-2 font-medium">Intent</th>
                  <th className="pb-2 font-medium">Route</th>
                  <th className="pb-2 font-medium">Amount</th>
                  <th className="pb-2 font-medium">Fee</th>
                  <th className="pb-2 font-medium">Fill</th>
                  <th className="pb-2 font-medium">Fill time</th>
                  <th className="pb-2 font-medium">Canonical</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((row) => {
                  const resolution = resolutionFor(row);
                  return (
                    <tr key={row.intent.intentId} className="border-t border-border/60">
                      <td className="num py-2.5">
                        <IntentLink
                          intentId={row.intent.intentId}
                          sourceChainId={row.intent.sourceChainId}
                          sourceTxHash={row.intent.sourceTxHash}
                        />
                      </td>
                      <td className="py-2.5">
                        <span className="flex items-center gap-1.5">
                          <ChainBadge chainId={row.intent.sourceChainId} />
                          <span className="text-text-dim">→</span>
                          <ChainBadge chainId={row.intent.destinationChainId} />
                        </span>
                      </td>
                      <td className="num py-2.5 text-text">
                        {formatUsdc(row.intent.amount)} USDC
                        <TradeTerms row={row} />
                      </td>
                      <td className="num py-2.5 text-text-dim">
                        {row.feeCharged === null ? "—" : `${formatUsdc(row.feeCharged)} USDC`}
                      </td>
                      <td className="py-2.5">
                        <FillChip resolution={resolution} row={row} />
                      </td>
                      <td className="num py-2.5 text-text-dim">
                        {resolution.kind !== "PENDING" && resolution.seconds !== null
                          ? formatDuration(resolution.seconds)
                          : "—"}
                      </td>
                      <td className="py-2.5">
                        <CanonicalStatusChip status={row.settlement.canonicalStatus} />
                      </td>
                      <td className="py-2.5 text-text-dim">
                        <TimeValue at={row.intent.createdAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </StateSection>
    </section>
  );
}
