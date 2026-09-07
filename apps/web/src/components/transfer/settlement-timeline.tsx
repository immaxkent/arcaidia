import { CHAINS } from "@/lib/arcaidia/types";
import type { AgentDecision, Intent, IntentSettlementState } from "@/lib/arcaidia/types";
import { TimeValue } from "@/components/site/time-value";
import { formatDuration, formatUsdc } from "@/lib/arcaidia/format";
import { cn } from "@/lib/utils";

type NodeState = "DONE" | "ACTIVE" | "PENDING" | "NEUTRAL";

interface TrackNode {
  label: string;
  detail?: string | undefined;
  at?: number | undefined;
  state: NodeState;
  txUrl?: string | undefined;
}

function TrackColumn({
  title,
  caption,
  tone,
  nodes,
  footer,
}: {
  title: string;
  caption: string;
  tone: "electric" | "gold";
  nodes: TrackNode[];
  footer: React.ReactNode;
}) {
  const dot = tone === "electric" ? "bg-electric" : "bg-gold";
  const ring = tone === "electric" ? "border-electric" : "border-gold";
  const text = tone === "electric" ? "text-electric-glow" : "text-gold-glow";

  return (
    <section className="panel flex flex-1 flex-col p-4 sm:p-5">
      <header className="mb-4">
        <h3 className={cn("text-sm font-semibold tracking-wide uppercase", text)}>{title}</h3>
        <p className="mt-1 text-xs text-text-dim">{caption}</p>
      </header>
      <ol className="relative flex-1 space-y-5 pl-5">
        <span className="absolute top-1.5 bottom-2 left-[3px] w-px bg-border" aria-hidden />
        {nodes.map((node) => (
          <li key={node.label} className="relative">
            <span
              aria-hidden
              className={cn(
                "absolute top-1 -left-5 size-[7px] rounded-full border",
                node.state === "DONE" && cn(dot, ring),
                node.state === "ACTIVE" && cn(dot, ring, "pulse-node"),
                node.state === "PENDING" && "border-border bg-surface-raised",
                node.state === "NEUTRAL" && "border-text-dim bg-text-dim/40",
              )}
            />
            <p
              className={cn(
                "text-sm",
                node.state === "PENDING" ? "text-text-dim" : "text-text",
                node.state === "ACTIVE" && text,
              )}
            >
              {node.label}
            </p>
            {node.detail ? <p className="num mt-0.5 text-xs text-text-dim">{node.detail}</p> : null}
            <div className="mt-1 flex items-center gap-3 text-xs text-text-dim">
              {node.at ? (
                <TimeValue at={node.at} mode="clock" className="num" />
              ) : null}
              {node.txUrl ? (
                <a href={node.txUrl} target="_blank" rel="noreferrer" className={cn("hover:underline", text)}>
                  transaction ↗
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <footer className="mt-5 border-t border-border pt-4">{footer}</footer>
    </section>
  );
}

export function SettlementTimeline({
  intent,
  settlement,
  decision,
  canonicalEtaSeconds = null,
}: {
  intent: Intent;
  settlement: IntentSettlementState;
  decision: AgentDecision | null;
  /** Only from a real protocol-published ETA; null renders an honest placeholder. */
  canonicalEtaSeconds?: number | null;
}) {
  const sourceExplorer = CHAINS[intent.sourceChainId]?.explorer;
  const fallback = settlement.canonicalOutcome === "RECIPIENT_FALLBACK";
  const fastFilled = settlement.fastStatus === "FAST_FILLED";
  const settled = settlement.canonicalStatus === "SETTLED";

  const fastNodes: TrackNode[] = fallback
    ? [
        { label: "Intent committed", at: intent.createdAt, state: "DONE" },
        { label: "No solver — settling directly", state: "NEUTRAL", detail: "Circle pays the recipient" },
      ]
    : [
        {
          label: "Intent committed",
          at: intent.createdAt,
          state: "DONE",
          ...(intent.sourceTxHash && sourceExplorer
            ? { txUrl: `${sourceExplorer}/tx/${intent.sourceTxHash}` }
            : {}),
        },
        {
          label: "Verified by solver",
          detail: decision ? `${decision.inputsUsed.sourceConfirmations} / ${decision.inputsUsed.requiredConfirmations} confirmations` : undefined,
          at: decision?.decidedAt,
          state: decision ? "DONE" : "ACTIVE",
        },
        {
          label: "Fee quoted",
          detail: decision ? `${formatUsdc(decision.feeAmount)} USDC` : undefined,
          at: decision?.decidedAt,
          state: decision ? "DONE" : "PENDING",
        },
        {
          label: "Paid",
          detail: decision ? `${formatUsdc(decision.outputAmount)} USDC` : undefined,
          at: settlement.fastFilledAt,
          state: fastFilled ? "DONE" : decision ? "ACTIVE" : "PENDING",
        },
      ];

  const canonicalNodes: TrackNode[] = [
    { label: "Committed to CCTP", at: intent.createdAt, state: "DONE" },
    { label: "Awaiting attestation", state: settled ? "DONE" : "ACTIVE" },
    { label: "Settling", state: settled ? "DONE" : "PENDING" },
    {
      label: fallback ? "Recipient paid directly" : "Liquidity vault repaid",
      detail: fallback ? `${formatUsdc(intent.amount)} USDC` : undefined,
      at: settlement.settledAt,
      state: settled ? "DONE" : "PENDING",
    },
  ];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-8">
      <TrackColumn
        title="Fast path"
        caption="The advance from the liquidity vault."
        tone="electric"
        nodes={fastNodes}
        footer={
          fallback ? (
            <p className="text-sm text-text-dim">
              No solver participated. This is a normal outcome — the canonical path pays the recipient.
            </p>
          ) : fastFilled ? (
            <div>
              <p className="text-sm font-semibold text-electric-glow">You&apos;re done</p>
              <p className="num mt-1 text-lg text-text">
                {formatUsdc(decision?.outputAmount ?? 0n)} USDC
                <span className="ml-2 text-xs text-text-dim">to the recipient</span>
              </p>
              {settlement.fastFilledAt ? (
                <p className="mt-1 text-xs text-text-dim">
                  <TimeValue at={settlement.fastFilledAt} />
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-text-dim">Waiting on the solver&apos;s verification and quote.</p>
          )
        }
      />
      <TrackColumn
        title="Canonical path"
        caption="Circle&apos;s CCTP transfer, settling on its own schedule."
        tone="gold"
        nodes={canonicalNodes}
        footer={
          settled ? (
            <div>
              <p className="text-sm font-semibold text-gold-glow">Canonical settlement complete</p>
              <p className="mt-1 text-xs text-text-dim">
                {settlement.canonicalOutcome === "RECIPIENT_FALLBACK"
                  ? "Recipient was paid directly by CCTP."
                  : "The liquidity vault has been reimbursed."}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gold-glow">
                {canonicalEtaSeconds === null
                  ? "Awaiting canonical settlement"
                  : `~${formatDuration(canonicalEtaSeconds)} remaining`}
              </p>
              <p className="mt-1 text-xs text-text-dim">
                Minutes, not seconds. The liquidity provider carries the transfer until then.
              </p>
            </div>
          )
        }
      />
    </div>
  );
}
