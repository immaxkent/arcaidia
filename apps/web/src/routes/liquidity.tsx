import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CopyValue } from "@/components/site/copy-value";
import { ARC_TESTNET, CHAINS, ETHEREUM_SEPOLIA, type Address } from "@/lib/arcaidia/types";
import { formatBps, formatDuration, formatUsdc, truncateAddress } from "@/lib/arcaidia/format";
import {
  ChainBadge,
  FillsTable,
  OperatorBadge,
  StatusChip,
  UtilisationMeter,
} from "@/components/vaults/vault-bits";
import {
  AwaitingSource,
  EmptyChart,
  StateSection,
  StateValue,
} from "@/components/data/state-views";
import { NOT_AVAILABLE } from "@/lib/arcaidia/data-state";
import {
  useAggregateVaultState,
  useVaults,
  useVaultAnalytics,
  type VaultDirectoryRow,
} from "@/hooks/arcaidia/use-vaults";
import { useVaultFills } from "@/hooks/arcaidia/use-vault-fills";
import { useMarketIntelligence } from "@/hooks/arcaidia/use-market-intelligence";

export const Route = createFileRoute("/liquidity")({
  head: () => ({
    meta: [
      { title: "Liquidity market — Arcaidia" },
      {
        name: "description",
        content:
          "Ethereum and Arc vault directories: the Arcaidia House Vault alongside independent solver vaults, each risking its own capital for the first valid fill.",
      },
      { property: "og:title", content: "Liquidity market — Arcaidia" },
      {
        property: "og:description",
        content:
          "House vault plus permissionless solver vaults. First valid fill wins; canonical CCTP settlement reimburses the winner.",
      },
    ],
  }),
  component: LiquidityPage,
});

/** Renders a nullable contract-derived value as `--` when the source cannot answer. */
function value<T>(v: T | null, format: (x: T) => string): string {
  return v === null ? NOT_AVAILABLE : format(v);
}

/**
 * HANDOFF — vault directory + detail.
 * WIRE: useVaults (house vault per chain in V1, Factory/Registry for the Intent
 * Market), useVaultFills (indexed fills), useVaultAnalytics (real historical
 * series), useMarketIntelligence (x402 endpoints). No vault, liquidity,
 * utilisation, fee, fill count or latency value is fabricated here.
 */
function LiquidityPage() {
  const [chainId, setChainId] = useState(ETHEREUM_SEPOLIA);
  const [selected, setSelected] = useState<Address | null>(null);
  const [tab, setTab] = useState<"OVERVIEW" | "FILLS">("OVERVIEW");

  const directory = useVaults(chainId);
  const market = useMarketIntelligence(chainId);
  const aggregate = useAggregateVaultState(directory);
  const vault =
    directory.status === "ready"
      ? (directory.data.find((v) => v.vaultAddress === selected) ?? null)
      : null;

  const openVault = (address: Address) => {
    setSelected(address);
    setTab("OVERVIEW");
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl uppercase text-newsprint sm:text-5xl">
        Liquidity market
      </h1>
      <p className="measure mt-2 text-sm text-text-dim">
        Arcaidia is not one pool. Every destination chain has its own directory of vaults: the{" "}
        <span className="text-gold-glow">Arcaidia House Vault</span> plus{" "}
        <span className="text-acid">permissionless independent solver vaults</span>. Each vault
        risks capital it owns to advance USDC to a recipient, and{" "}
        <span className="text-text">the first valid fill wins</span>. Canonical CCTP settlement
        later reimburses whichever vault filled — it is not best-price execution, and reimbursement
        is not yet trustless.
      </p>

      {/* Aggregate liquidity/utilisation/exposure are real, computed client-side
          from the same vault directory read below — V1 has exactly one vault
          per chain, so "aggregate" is honestly just that vault's own numbers
          today, no dedicated service required. Fee range and canonical
          settlement latency percentiles genuinely need the x402 market
          intelligence service (fee-quote history, per-fill latency samples) —
          those stay on `market`, unavailable until it's published. */}
      <section className="panel mt-6 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text">Market state</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <div className="instrument p-3">
            <dt className="text-[11px] uppercase tracking-wide text-text-dim">Aggregate liquidity</dt>
            <dd className="num mt-1 text-base text-text">
              <StateValue state={aggregate} format={(a) => formatUsdc(a.liquidity)} />
            </dd>
          </div>
          <div className="instrument p-3">
            <dt className="text-[11px] uppercase tracking-wide text-text-dim">Aggregate utilisation</dt>
            <dd className="num mt-1 text-base text-text">
              <StateValue state={aggregate} format={(a) => formatBps(a.utilisationBps)} />
            </dd>
          </div>
          <div className="instrument p-3">
            <dt className="text-[11px] uppercase tracking-wide text-text-dim">Executable fee range</dt>
            <dd className="num mt-1 text-base text-text">
              <StateValue
                state={market}
                format={(m: MarketFields) =>
                  m.executableFeeRangeBps === null
                    ? NOT_AVAILABLE
                    : `${formatBps(m.executableFeeRangeBps[0])} – ${formatBps(m.executableFeeRangeBps[1])}`
                }
              />
            </dd>
          </div>
          <div className="instrument p-3">
            <dt className="text-[11px] uppercase tracking-wide text-text-dim">Canonical latency (median)</dt>
            <dd className="num mt-1 text-base text-text">
              <StateValue
                state={market}
                format={(m: MarketFields) => value(m.medianCanonicalLatencySeconds, formatDuration)}
              />
            </dd>
          </div>
          <div className="instrument p-3">
            <dt className="text-[11px] uppercase tracking-wide text-text-dim">Canonical latency (p95)</dt>
            <dd className="num mt-1 text-base text-text">
              <StateValue
                state={market}
                format={(m: MarketFields) => value(m.p95CanonicalLatencySeconds, formatDuration)}
              />
            </dd>
          </div>
          <div className="instrument p-3">
            <dt className="text-[11px] uppercase tracking-wide text-text-dim">Outstanding settlement exposure</dt>
            <dd className="num mt-1 text-base text-text">
              <StateValue state={aggregate} format={(a) => formatUsdc(a.exposure)} />
            </dd>
          </div>
        </dl>
        <AwaitingSource>
          Fee range and settlement latency await the market intelligence service (/v1/settlement,
          /v1/risk) — liquidity and utilisation above are real, aggregated from the vault directory.
        </AwaitingSource>
      </section>

      <div
        className="mt-8 flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label="Vault directory"
      >
        {[ETHEREUM_SEPOLIA, ARC_TESTNET].map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={id === chainId}
            onClick={() => {
              setChainId(id);
              setSelected(null);
            }}
            className={`rounded-md border px-3.5 py-1.5 text-sm uppercase tracking-wide transition-colors ${
              id === chainId
                ? "border-acid/60 bg-acid/10 text-acid"
                : "border-border text-text-dim hover:text-text"
            }`}
          >
            {CHAINS[id]?.short} vaults
          </button>
        ))}
        <p className="num ml-auto text-xs text-text-dim">
          <StateValue
            state={directory}
            format={(rows) => `${rows.length} vaults`}
            fallback="Vault count unavailable"
          />
        </p>
      </div>

      <section className="panel mt-4 p-0">
        <h2 className="sr-only">{CHAINS[chainId]?.name} vault directory</h2>
        <StateSection
          state={directory}
          emptyTitle="No vaults yet"
          emptyNote="No solver vault has been deployed on this chain yet."
          unavailableTitle="Not available yet"
          unavailableNote="Vault discovery reads the House Vault and Factory/Registry events once those addresses are configured."
        >
          {(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-text-dim">
                    <th className="px-4 py-3 font-medium">Vault</th>
                    <th className="px-4 py-3 font-medium">Available</th>
                    <th className="px-4 py-3 font-medium">Advanced</th>
                    <th className="px-4 py-3 font-medium">Utilisation</th>
                    <th className="px-4 py-3 font-medium">Fee now</th>
                    <th className="px-4 py-3 font-medium">Fills</th>
                    <th className="px-4 py-3 font-medium">Lifetime fees</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((v) => (
                    <tr
                      key={v.vaultAddress}
                      className={`cursor-pointer border-t border-border/60 transition-colors hover:bg-surface-raised/60 ${
                        v.vaultAddress === selected ? "bg-surface-raised/80" : ""
                      }`}
                      onClick={() => openVault(v.vaultAddress)}
                    >
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-text">
                            {v.operatorLabel ?? truncateAddress(v.vaultAddress)}
                          </span>
                          <OperatorBadge type={v.operatorType} />
                          <ChainBadge chainId={v.chainId} />
                        </span>
                        <span
                          className="mt-1 flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <CopyValue
                            value={v.vaultAddress}
                            label="vault address"
                            className="text-[11px]"
                          />
                          <span className="text-[11px] text-text-dim">
                            {v.pricingModelId ?? NOT_AVAILABLE}
                          </span>
                        </span>
                      </td>
                      <td className="num px-4 py-3 text-text">
                        {value(v.availableLiquidity, formatUsdc)}
                      </td>
                      <td className="num px-4 py-3 text-gold-glow">
                        {value(v.outstandingExposure, formatUsdc)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-28">
                          <UtilisationMeter bps={v.utilisationBps} />
                        </div>
                      </td>
                      <td className="num px-4 py-3 text-acid">
                        {value(v.currentFeeBps, formatBps)}
                      </td>
                      <td className="num px-4 py-3 text-text-dim">
                        {value(v.successfulFillCount, (n) => n.toLocaleString("en-US"))}
                      </td>
                      <td className="num px-4 py-3 text-text-dim">
                        {value(v.lifetimeFees, formatUsdc)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip status={v.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </StateSection>
      </section>

      {vault ? (
        <VaultDetail vault={vault} tab={tab} setTab={setTab} onClose={() => setSelected(null)} />
      ) : null}

      {/* "Run your own vault" (permissionless solver onboarding) is a post-V1
          Intent Market surface — WP-INTENT-MARKET.md — not promoted here until
          that work starts. */}
    </div>
  );
}

type MarketFields = {
  aggregateLiquidity: bigint | null;
  aggregateUtilisationBps: number | null;
  executableFeeRangeBps: [number, number] | null;
  medianCanonicalLatencySeconds: number | null;
  p95CanonicalLatencySeconds: number | null;
  outstandingSettlementExposure: bigint | null;
};

function VaultDetail({
  vault,
  tab,
  setTab,
  onClose,
}: {
  vault: VaultDirectoryRow;
  tab: "OVERVIEW" | "FILLS";
  setTab: (t: "OVERVIEW" | "FILLS") => void;
  onClose: () => void;
}) {
  const fills = useVaultFills(vault.chainId, vault.vaultAddress);
  const analytics = useVaultAnalytics(vault.chainId, vault.vaultAddress);

  return (
    <section className="panel mt-6 p-5" aria-label="Vault detail">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h2 className="font-display text-3xl uppercase text-newsprint">
            {vault.operatorLabel ?? truncateAddress(vault.vaultAddress)}
          </h2>
          <p className="num mt-1 flex flex-wrap items-center gap-2 text-xs text-text-dim">
            <CopyValue value={vault.vaultAddress} label="vault address" />
            <OperatorBadge type={vault.operatorType} />
            <ChainBadge chainId={vault.chainId} />
            <StatusChip status={vault.status} />
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-wide text-text-dim hover:text-text"
        >
          Close
        </button>
      </div>

      <div className="mt-4 flex gap-2" role="tablist" aria-label="Vault detail sections">
        {(["OVERVIEW", "FILLS"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm uppercase tracking-wide ${
              tab === t ? "bg-surface-raised text-acid" : "text-text-dim hover:text-text"
            }`}
          >
            {t === "OVERVIEW" ? "Overview" : "Fills"}
          </button>
        ))}
      </div>

      {tab === "OVERVIEW" ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                k: "Available liquidity",
                v: value(vault.availableLiquidity, (x) => `${formatUsdc(x)} USDC`),
                tone: "text-text",
              },
              {
                k: "Outstanding exposure",
                v: value(vault.outstandingExposure, (x) => `${formatUsdc(x)} USDC`),
                tone: "text-gold-glow",
              },
              { k: "Current fee", v: value(vault.currentFeeBps, formatBps), tone: "text-acid" },
              {
                k: "Authorised solver",
                v: value(vault.authorisedSolver, (a) => truncateAddress(a)),
                tone: "text-electric-glow",
              },
              {
                k: "Successful fills",
                v: value(vault.successfulFillCount, (n) => n.toLocaleString("en-US")),
                tone: "text-text",
              },
              {
                k: "Lifetime fees",
                v: value(vault.lifetimeFees, (x) => `${formatUsdc(x)} USDC`),
                tone: "text-acid",
              },
              { k: "Pricing model", v: vault.pricingModelId ?? NOT_AVAILABLE, tone: "text-text" },
              { k: "Utilisation", v: value(vault.utilisationBps, formatBps), tone: "text-text" },
            ].map((m) => (
              <div key={m.k} className="instrument p-3">
                <dt className="text-[11px] uppercase tracking-wide text-text-dim">{m.k}</dt>
                <dd className={`num mt-1 text-lg ${m.tone}`}>{m.v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 max-w-md">
            <UtilisationMeter bps={vault.utilisationBps} />
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {analytics.status === "ready" && analytics.data.volumeSeries.length > 0 ? null : (
              <>
                <EmptyChart label="Volume history — awaiting indexed events" />
                <EmptyChart label="Fee history — awaiting indexed events" />
              </>
            )}
          </div>
          <p className="measure mt-4 text-sm text-text-dim">
            This vault advances its own capital on {CHAINS[vault.chainId]?.name} and earns the fee
            attached to each intent it fills first. Advanced capital returns when canonical CCTP
            settlement reimburses the vault; until then it counts as outstanding exposure. No
            reputation score is shown — the protocol does not have a defensible reputation model
            yet.
          </p>
          <AwaitingSource>
            Vault state from direct contract reads · aggregates and charts from the indexer
          </AwaitingSource>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm text-text-dim">
            Intents this vault won and funded. There is no losing-bid order book: first valid fill
            wins, so only completed fills exist onchain.
          </p>
          <FillsTable state={fills} />
        </>
      )}
    </section>
  );
}
