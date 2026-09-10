import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransferForm } from "@/components/transfer/transfer-form";
import { SettlementTimeline } from "@/components/transfer/settlement-timeline";
import { DecisionPanel } from "@/components/transfer/decision-panel";
import { IntentHistoryPanel } from "@/components/transfer/intent-history-panel";
import { useWallet } from "@/components/wallet/wallet-context";
import { EmptyPanel, StateSection } from "@/components/data/state-views";
import { IntentProvider, useIntent, useIntentSettlement } from "@/hooks/arcaidia/use-intent";
import type { AgentDecision } from "@/lib/arcaidia/types";

export const Route = createFileRoute("/transfer")({
  head: () => ({
    meta: [
      { title: "Transfer USDC — Arcaidia" },
      {
        name: "description",
        content:
          "Move USDC between Ethereum and Arc in one form, and watch both settlement facts: the fast advance and the canonical CCTP settlement.",
      },
      { property: "og:title", content: "Transfer USDC — Arcaidia" },
      {
        property: "og:description",
        content: "One form, both directions. Two independent settlement tracks, never merged.",
      },
    ],
  }),
  component: TransferPage,
});

/**
 * HANDOFF — no example intent, tx hash, fee or timeline is rendered here.
 * The timeline appears only once useIntent() reports a real created intent and
 * useIntentSettlement() reports real fast-fill / canonical settlement facts.
 *
 * IntentProvider is mounted here, once, above both the form and the settlement
 * panel below — they are siblings that must share one created-intent instance.
 */
function TransferPage() {
  return (
    <IntentProvider>
      <TransferPageContent />
    </IntentProvider>
  );
}

function TransferPageContent() {
  const { status, address, connect } = useWallet();
  const { state: intentState } = useIntent();
  const intent = intentState.status === "ready" ? intentState.data : null;
  const settlement = useIntentSettlement(intent?.intentId ?? null);
  // The live pre-submission quote (WP-14) — lifted out of TransferForm so this
  // sibling panel can show it too. Never the post-submission recorded decision
  // SettlementTimeline wants (that stays null until real telemetry exists).
  const [liveQuote, setLiveQuote] = useState<AgentDecision | null>(null);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold text-text sm:text-3xl">Transfer</h1>
      <p className="measure mt-2 text-sm text-text-dim">
        One form handles both directions. Two settlement facts are tracked separately — the advance you receive,
        and the canonical CCTP settlement that repays the vault.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(360px,420px)_1fr] lg:gap-8">
        <div>
          <TransferForm onQuoteChange={setLiveQuote} />
        </div>
        <div className="space-y-6">
          {status !== "CONNECTED" ? (
            <div className="panel px-4 py-3">
              <p className="text-sm text-text-dim">
                Connect a wallet to create a transfer and track its settlement here.
              </p>
              <button
                type="button"
                onClick={connect}
                className="mt-3 rounded-md border border-acid/60 bg-acid/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-acid"
              >
                Connect wallet
              </button>
            </div>
          ) : null}

          <div className="panel">
            <StateSection
              state={settlement}
              emptyTitle="No intents yet"
              emptyNote="Your settlement tracks appear here the moment an intent is created onchain."
              unavailableTitle="No intents yet"
              unavailableNote="Nothing is shown until a real intent exists — no example transfer is displayed."
            >
              {(data) =>
                intent ? (
                  <div className="p-4">
                    <SettlementTimeline intent={intent} settlement={data} decision={null} />
                  </div>
                ) : (
                  <EmptyPanel title="No intents yet" />
                )
              }
            </StateSection>
          </div>

          <DecisionPanel decision={liveQuote} />

          <IntentHistoryPanel owner={address} />
        </div>
      </div>
    </div>
  );
}
