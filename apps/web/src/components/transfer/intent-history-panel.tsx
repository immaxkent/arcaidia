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

function FillChip({ resolution }: { resolution: Resolution }) {
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

export function IntentHistoryPanel({ owner }: { owner: Address | null }) {
  const history = useIntentHistory(owner, [ETHEREUM_SEPOLIA, ARC_TESTNET]);
  return (
    <IntentHistoryTable
      title="Your transfers"
      history={history}
      emptyTitle="No transfers yet"
      emptyNote="Every transfer you create appears here, live — the fast advance and the canonical settlement, tracked separately."
      unavailableTitle="No transfers yet"
      unavailableNote="Connect a wallet to see your transfer history."
    />
  );
}

/**
 * Every transfer across the whole market, no ownership filter — a public,
 * view-only feed. Same table, same live join, deliberately no "connect a
 * wallet" gate: unlike `IntentHistoryPanel`, nothing here ever depended on
 * who's connected.
 */
export function AllTransfersPanel() {
  const history = useAllTransfers([ETHEREUM_SEPOLIA, ARC_TESTNET]);
  return (
    <IntentHistoryTable
      title="All transfers"
      history={history}
      emptyTitle="No transfers yet"
      emptyNote="Every transfer across the market appears here, live — the fast advance and the canonical settlement, tracked separately."
      unavailableTitle="No transfers yet"
      unavailableNote="Indexer not connected."
    />
  );
}

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
  return (
    <section className="panel p-5">
      <h3 className="text-sm font-semibold tracking-wide text-text uppercase">{title}</h3>
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
                {rows.map((row) => {
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
                      <td className="num py-2.5 text-text">{formatUsdc(row.intent.amount)} USDC</td>
                      <td className="num py-2.5 text-text-dim">
                        {row.feeCharged === null ? "—" : `${formatUsdc(row.feeCharged)} USDC`}
                      </td>
                      <td className="py-2.5">
                        <FillChip resolution={resolution} />
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
