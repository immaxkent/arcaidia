import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AwaitingSource, StateValue } from "@/components/data/state-views";
import { ChainBadge } from "@/components/vaults/vault-bits";
import { VaultName } from "@/components/vaults/vault-identity";
import { useEcosystemIntelligence } from "@/hooks/arcaidia/use-market-intelligence";
import { useSolverTelemetry } from "@/hooks/arcaidia/use-solver-telemetry";
import { useVaults, type VaultDirectoryRow } from "@/hooks/arcaidia/use-vaults";
import { formatTinybar, gatewayBaseUrl, hashscanTransactionUrl, useChallenge, useGatewayPricing, type PaymentChallenge } from "@/hooks/arcaidia/use-x402-gateway";
import { NOT_AVAILABLE } from "@/lib/arcaidia/data-state";
import { formatBps, formatDuration, formatUsdc } from "@/lib/arcaidia/format";
import { ARC_TESTNET, ETHEREUM_SEPOLIA } from "@/lib/arcaidia/types";

export const Route = createFileRoute("/intelligence")({
  head: () => ({
    meta: [
      { title: "Intelligence — paid ecosystem data over Hedera x402" },
      {
        name: "description",
        content:
          "Arcaidia's ecosystem intelligence — liquidity, fee distribution, scarcity and settlement latency — sold per request over Hedera x402. Solvers pay in HBAR; the paywall answers 402 to everyone else.",
      },
    ],
  }),
  component: IntelligencePage,
});

/**
 * WP-35. Three things, all real or null: the ecosystem view the relay computes (free here —
 * it is the demo's own reading of its own market), the gateway's live price list and 402
 * challenge, and which solvers are paying for it (their own heartbeat self-reports, with the
 * Hedera transaction each last paid). Nothing on this page holds a key or pays: a solver pays
 * from its own Hedera account, and the receipt is what it reports back.
 */
function IntelligencePage() {
  const ecosystem = useEcosystemIntelligence();
  const pricing = useGatewayPricing();
  const gateway = gatewayBaseUrl();

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_520px]">
        <div>
          <h1 className="font-display text-4xl uppercase text-newsprint sm:text-5xl">Intelligence</h1>
          <p className="measure mt-2 text-sm text-text-dim">
            Every figure below is computed by the relay from the indexed chains — how much USDC is available to fill with, what the vaults are charging,
            how scarce capital is right now, how long canonical settlement is taking. A solver deciding whether to advance its own capital can buy this
            view <span className="text-acid">per request, in HBAR, over Hedera x402</span>: the gateway answers <span className="num text-text">402</span> with the
            price, the solver signs a Hedera transfer, and the facilitator settles it before the answer is released. The protocol never depends on it — a
            solver with no Hedera account runs the same code, unpaid, and fills the same intents.
          </p>
        </div>
        <PaywallProbe />
      </div>

      <section className="panel mt-6 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text">Ecosystem view</h2>
          <span className="num text-[11px] text-text-dim">
            <StateValue state={ecosystem} format={(v) => `computed ${new Date(v.computedAt * 1000).toLocaleTimeString()} · ${v.vaultCount} vaults`} />
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Available liquidity" state={ecosystem} format={(v) => `${formatUsdc(v.aggregateLiquidity)} USDC`} />
          <Metric label="Aggregate utilisation" state={ecosystem} format={(v) => formatBps(v.aggregateUtilisationBps)} />
          <Metric label="Fee band (min · median · max)" state={ecosystem} format={(v) => [v.feeMinBps, v.feeMedianBps, v.feeMaxBps].map((b) => (b === null ? NOT_AVAILABLE : formatBps(b))).join(" · ")} />
          <Metric label="Scarcity score" state={ecosystem} format={(v) => `${(v.scarcityScoreBps / 100).toFixed(1)} / 100`} tone={(v) => (v.scarcityScoreBps >= 6_000 ? "text-warning" : "text-acid")} />
          <Metric label="Outstanding intent volume" state={ecosystem} format={(v) => `${formatUsdc(v.outstandingIntentVolume)} USDC`} />
          <Metric label="Pending CCTP exposure" state={ecosystem} format={(v) => `${formatUsdc(v.pendingCctpExposure)} USDC`} />
          <Metric label="Fill velocity" state={ecosystem} format={(v) => (v.recentFillVelocityPerHour === null ? NOT_AVAILABLE : `${v.recentFillVelocityPerHour.toFixed(1)} / hour`)} />
          <Metric
            label="Settlement latency (p50 · p95)"
            state={ecosystem}
            format={(v) => `${v.p50LatencySeconds === null ? NOT_AVAILABLE : formatDuration(v.p50LatencySeconds)} · ${v.p95LatencySeconds === null ? NOT_AVAILABLE : formatDuration(v.p95LatencySeconds)} (${v.latencySamples})`}
          />
        </dl>
        <AwaitingSource>
          Served free here by the relay; the identical bytes are what the gateway sells. A solver in <span className="text-acid">selective</span> mode holds a fill when its
          fee sits under the median and scarcity is above its threshold (D13).
        </AwaitingSource>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text">Price list</h2>
          {pricing.status === "ready" ? (
            <>
              <dl className="num mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-dim">
                <dt>Network</dt>
                <dd className="text-text">{pricing.data.network}</dd>
                <dt>Pay to</dt>
                <dd className="text-text">{pricing.data.payTo}</dd>
                <dt>Facilitator</dt>
                <dd className="truncate text-text">{pricing.data.facilitator}</dd>
              </dl>
              <table className="mt-3 w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-text-dim">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Endpoint</th>
                    <th className="py-1 pr-2 font-medium">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.data.endpoints.map((e) => (
                    <tr key={e.id} className="border-t border-border/60 align-top">
                      <td className="py-2 pr-2">
                        <span className="num text-text">
                          {e.method} {e.path}
                        </span>
                        <p className="mt-0.5 text-text-dim">{e.description}</p>
                      </td>
                      <td className="num whitespace-nowrap py-2 text-acid">{formatTinybar(e.price.tinybar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : pricing.status === "loading" ? (
            <p className="mt-3 text-xs text-text-dim">Reading the gateway's price list…</p>
          ) : (
            <p className="mt-3 text-xs text-text-dim">{pricing.status === "error" ? (pricing.error ?? "Gateway unreachable") : pricing.status === "unavailable" ? (pricing.reason ?? NOT_AVAILABLE) : NOT_AVAILABLE}</p>
          )}
          <AwaitingSource>Read live from the gateway's free /v1/pricing — the same table its paywall enforces</AwaitingSource>
        </section>

        <section className="panel p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text">Pay from your solver</h2>
          <p className="mt-2 text-xs text-text-dim">
            Two lines in the solver's env turn the free relay read into a paid one. The key signs HBAR transfers for exactly the quoted amount and nothing
            else; it never leaves the solver. <Link to="/earn" className="text-acid hover:underline">Earn</Link> writes these for you with the paid-intelligence switch on.
          </p>
          <pre className="num mt-3 overflow-x-auto rounded-md border border-border bg-void px-3 py-3 text-[11px] leading-relaxed text-text-dim">
            {`INTELLIGENCE_URL=${gateway ?? "https://<gateway>"}
INTELLIGENCE_MODE=advisory      # or selective (D13): may hold an under-priced fill
HEDERA_ACCOUNT_ID=0.0.<your account>
HEDERA_PRIVATE_KEY=<hex ECDSA key — never shared>`}
          </pre>
          <p className="mt-3 text-xs text-text-dim">Or see the challenge yourself:</p>
          <pre className="num mt-2 overflow-x-auto rounded-md border border-border bg-void px-3 py-3 text-[11px] leading-relaxed text-text-dim">
            {`curl -si ${gateway ?? "https://<gateway>"}/v1/intelligence/ecosystem | grep -i payment-required`}
          </pre>
          <AwaitingSource>Payments are per request; the paying account must differ from the gateway's pay-to account (a self-transfer nets to zero)</AwaitingSource>
        </section>
      </div>

      <PayingSolvers />
    </div>
  );
}

function Metric<T>({ label, state, format, tone }: { label: string; state: Parameters<typeof StateValue<T>>[0]["state"]; format: (v: T) => string; tone?: (v: T) => string }) {
  const toneClass = state.status === "ready" && tone ? tone(state.data) : "text-text";
  return (
    <div className="instrument p-3">
      <dt className="text-[11px] uppercase tracking-wide text-text-dim">{label}</dt>
      <dd className={`num mt-1 text-base ${toneClass}`}>
        <StateValue state={state} format={format} />
      </dd>
    </div>
  );
}

/** A live unpaid request to a priced route: the gateway's real 402 and what it asks for. */
function PaywallProbe() {
  const gateway = gatewayBaseUrl();
  const challenge = useChallenge();
  const [path, setPath] = useState("/v1/intelligence/ecosystem");
  const result: PaymentChallenge | undefined = challenge.data;
  return (
    <section className="panel p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text">Live paywall</h2>
        <span className="num text-[10px] uppercase tracking-wide text-text-dim">{gateway ? "gateway online" : "no gateway configured"}</span>
      </div>
      <p className="mt-2 text-xs text-text-dim">Ask the gateway without paying. It should refuse with the exact terms a solver would then pay.</p>
      <div className="mt-3 flex gap-2">
        <select value={path} onChange={(e) => setPath(e.target.value)} className="num min-w-0 flex-1 rounded-md border border-border bg-void px-2 py-2 text-xs text-text">
          <option value="/v1/intelligence/ecosystem">/v1/intelligence/ecosystem</option>
          <option value={`/v1/intelligence/chain/${ARC_TESTNET}`}>/v1/intelligence/chain/{ARC_TESTNET}</option>
          <option value={`/v1/intelligence/chain/${ETHEREUM_SEPOLIA}`}>/v1/intelligence/chain/{ETHEREUM_SEPOLIA}</option>
          <option value={`/v1/intelligence/quote-context?amount=20000000&destinationChainId=${ARC_TESTNET}`}>/v1/intelligence/quote-context (20 USDC → Arc)</option>
        </select>
        <button
          type="button"
          disabled={!gateway || challenge.isPending}
          onClick={() => challenge.mutate(path)}
          className="rounded-lg border border-acid/60 bg-acid/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-acid disabled:opacity-50"
        >
          {challenge.isPending ? "Asking…" : "Request unpaid"}
        </button>
      </div>
      {challenge.isError ? <p className="mt-3 text-xs text-warning">{challenge.error.message}</p> : null}
      {result ? (
        <dl className="num mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-text-dim">
          <dt>Status</dt>
          <dd className={result.status === 402 ? "text-acid" : "text-warning"}>{result.status === 402 ? "402 Payment Required" : `${result.status} (expected 402)`}</dd>
          <dt>Price</dt>
          <dd className="text-text">{result.amount ? `${formatTinybar(result.amount)} (${result.amount} tinybar, asset ${result.asset ?? "?"})` : NOT_AVAILABLE}</dd>
          <dt>Pay to</dt>
          <dd className="text-text">{result.payTo ?? NOT_AVAILABLE}</dd>
          <dt>Fee payer</dt>
          <dd className="text-text">{result.feePayer ?? NOT_AVAILABLE}</dd>
          <dt>Scheme</dt>
          <dd className="text-text">{result.scheme && result.network ? `${result.scheme} on ${result.network}` : NOT_AVAILABLE}</dd>
          <dt>Valid for</dt>
          <dd className="text-text">{result.maxTimeoutSeconds === null ? NOT_AVAILABLE : `${result.maxTimeoutSeconds}s`}</dd>
        </dl>
      ) : null}
      <AwaitingSource>Decoded from the PAYMENT-REQUIRED header the gateway returned to this browser just now</AwaitingSource>
    </section>
  );
}

/** Every vault's solver, by its own heartbeat: who reads intelligence, who pays, and the last Hedera transaction. */
function PayingSolvers() {
  const sepolia = useVaults(ETHEREUM_SEPOLIA);
  const arc = useVaults(ARC_TESTNET);
  const rows = [...(sepolia.status === "ready" ? sepolia.data : []), ...(arc.status === "ready" ? arc.data : [])];
  return (
    <section className="panel mt-6 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text">Solvers using it</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-text-dim">{sepolia.status === "loading" || arc.status === "loading" ? "Reading the vault directories…" : "No vaults found."}</p>
      ) : (
        <table className="mt-3 w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-text-dim">
            <tr>
              <th className="py-1 pr-2 font-medium">Vault</th>
              <th className="py-1 pr-2 font-medium">Chain</th>
              <th className="py-1 pr-2 font-medium">Intelligence</th>
              <th className="py-1 pr-2 font-medium">Payments</th>
              <th className="py-1 pr-2 font-medium">Last Hedera transaction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <SolverRow key={`${row.chainId}:${row.vaultAddress}`} row={row} />
            ))}
          </tbody>
        </table>
      )}
      <AwaitingSource>Each solver's own heartbeat self-report via the relay — an operator assertion, never read by any contract</AwaitingSource>
    </section>
  );
}

function SolverRow({ row }: { row: VaultDirectoryRow }) {
  const telemetry = useSolverTelemetry(row.chainId, row.vaultAddress);
  const report = telemetry.status === "ready" ? telemetry.data.intelligence : null;
  const online = telemetry.status === "ready" && telemetry.data.online;
  return (
    <tr className="border-t border-border/60">
      <td className="py-2 pr-2">
        <VaultName label={row.operatorLabel} address={row.vaultAddress} size="sm" />
      </td>
      <td className="py-2 pr-2">
        <ChainBadge chainId={row.chainId} />
      </td>
      <td className="num py-2 pr-2">
        {!online ? <span className="text-text-dim">offline</span> : report ? <span className={report.paid ? "text-acid" : "text-text"}>{report.mode}{report.paid ? " · paid" : " · free"}</span> : <span className="text-text-dim">none</span>}
      </td>
      <td className="num py-2 pr-2 text-text">{report?.paid ? `${report.payments}${report.totalTinybar !== "0" ? ` · ${formatTinybar(report.totalTinybar)}` : ""}` : NOT_AVAILABLE}</td>
      <td className="num py-2 pr-2">
        {report?.lastTransaction ? (
          <a href={hashscanTransactionUrl(report.lastTransaction)} target="_blank" rel="noreferrer" className="text-electric-glow hover:underline">
            {report.lastTransaction}
          </a>
        ) : (
          <span className="text-text-dim">{NOT_AVAILABLE}</span>
        )}
      </td>
    </tr>
  );
}
