import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransferForm } from "@/components/transfer/transfer-form";
import { DecisionPanel } from "@/components/transfer/decision-panel";
import { IntentHistoryPanel } from "@/components/transfer/intent-history-panel";
import { useWallet } from "@/components/wallet/wallet-context";
import { IntentProvider } from "@/hooks/arcaidia/use-intent";
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
 * HANDOFF — no example intent, tx hash or fee is rendered here.
 *
 * IntentProvider is mounted here so TransferForm can call useIntent().createIntent
 * for the actual submit action. Live and historical settlement status both come
 * from IntentHistoryPanel (real subgraph data, both fast and canonical facts,
 * tracked separately) rather than a separate just-submitted-this-session view —
 * that used to exist here as its own panel, but it was never wired past a
 * permanent "unavailable" stub, and IntentHistoryPanel already covers the need
 * live, so it was removed rather than left as dead placeholder UI.
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
  // The live pre-submission quote (WP-14) — lifted out of TransferForm so this
  // sibling panel can show it too.
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

          <DecisionPanel decision={liveQuote} />

          <IntentHistoryPanel owner={address} />
        </div>
      </div>
    </div>
  );
}
