import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";
import { viemChainFor } from "@/lib/arcaidia/viem-chains";
import { chainConfig } from "@/lib/arcaidia/config";
import { CopyValue } from "@/components/site/copy-value";
import { TimeValue } from "@/components/site/time-value";
import { SolverOrb } from "@/components/solver/solver-orb";
import { VaultFeeTierChart, VaultUtilisationChart } from "@/components/solver/utilisation-chart";
import { ChainBadge, FillsTable, UtilisationMeter } from "@/components/vaults/vault-bits";
import { useWallet } from "@/components/wallet/wallet-context";
import { CHAINS, type ActivityRow, type SolverAuthState, type SolverRuntimeStatus } from "@/lib/arcaidia/types";
import { formatBps, formatDuration, formatUsdc, truncateAddress } from "@/lib/arcaidia/format";
import { explorerTxUrl, SUPPORTED_CHAIN_IDS } from "@/lib/arcaidia/config";
import { NOT_AVAILABLE, errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import { AwaitingSource, StateSection, StateValue } from "@/components/data/state-views";
import { solverVaultAbi, vaultCapabilitiesFromAbi, type VaultCapability } from "@/lib/arcaidia/abis";
import { useQueryClient } from "@tanstack/react-query";
import { useIntentOutcome } from "@/hooks/arcaidia/use-intent-outcome";
import { useSolverMetrics } from "@/hooks/arcaidia/use-solver-metrics";
import { useSolverTelemetry } from "@/hooks/arcaidia/use-solver-telemetry";
import { useVaultActivity, useVaultFills } from "@/hooks/arcaidia/use-vault-fills";
import { useVaultAnalytics, useVaults, type VaultDirectoryRow } from "@/hooks/arcaidia/use-vaults";
import { deriveOnchainStage } from "@/lib/arcaidia/solver-stage";

export const Route = createFileRoute("/console")({
  head: () => ({
    meta: [
      { title: "Solver console — watch the market live | Arcaidia" },
      {
        name: "description",
        content:
          "Every vault competing in the intent market, on both chains: authorised solver status, settled volume, fees earned, its own utilisation over time, and a stage-by-stage execution timeline separating solver telemetry from onchain-confirmed state.",
      },
      { property: "og:title", content: "Solver console — Arcaidia" },
      {
        property: "og:description",
        content:
          "A public, view-only window onto every vault in the market — authorised solver status, realised fills and live execution timelines.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConsolePage,
});

type Tab = "FILLS" | "ACTIVITY";

/**
 * The whole market's vault directory, both chains merged into one list —
 * every vault that has ever won a fastFill, plus each chain's House Vault
 * unconditionally (see use-vaults.ts's own doc comment for the known
 * "never won yet" limitation). This is a view-only window onto the market:
 * a vault appearing here is not "yours" by any special status, and owning
 * one is not required to watch it — that's what makes this the Solver
 * Console rather than "my vaults".
 */
function useMarketVaultDirectory(): DataState<VaultDirectoryRow[]> {
  // Explicitly two calls, not a `.map()` over SUPPORTED_CHAIN_IDS — the
  // Rules of Hooks care about a stable call count/order across renders, and
  // spelling it out here makes that obviously true without relying on a
  // reader also checking that SUPPORTED_CHAIN_IDS is a compile-time constant.
  const sepolia = useVaults(SUPPORTED_CHAIN_IDS[0]);
  const arc = useVaults(SUPPORTED_CHAIN_IDS[1]);
  const perChain = [sepolia, arc];

  if (perChain.some((s) => s.status === "loading")) return { status: "loading" };
  const rows = perChain.flatMap((s) => (s.status === "ready" ? s.data : []));
  const errored = perChain.find((s) => s.status === "error");
  // One chain's RPC being unreachable must not blank the other chain's vaults: the market is
  // shown for whatever can be read, and the failure is reported next to it (see ConsolePage).
  if (rows.length === 0 && errored && errored.status === "error") return errorState(errored.error);
  if (rows.length === 0) return unavailableState("No vaults deployed anywhere yet");
  return readyState(rows);
}

/** The chains whose directory read failed, with the reason — shown as a notice, never hidden. */
function useDirectoryProblems(): string[] {
  const sepolia = useVaults(SUPPORTED_CHAIN_IDS[0]);
  const arc = useVaults(SUPPORTED_CHAIN_IDS[1]);
  return [sepolia, arc].flatMap((s, i) =>
    s.status === "error" ? [`${CHAINS[SUPPORTED_CHAIN_IDS[i]!]?.short ?? SUPPORTED_CHAIN_IDS[i]}: ${s.error}`] : [],
  );
}

/**
 * HANDOFF — Solver Console.
 *
 * Data sources, none of them simulated:
 *   vault list  -> useMarketVaultDirectory: every vault across both chains (WP-21.1's own
 *                  "derive participants from fill history" approach)
 *   metrics     -> useSolverMetrics: SolverVault reads + indexed winning fills
 *   orb stages  -> useSolverTelemetry (pre-chain only) + real onchain stage
 *   fills       -> useVaultFills (indexed, starts empty)
 *   activity    -> useVaultActivity (lost races / reverts, kept separate)
 * Owner controls render only when the connected wallet is that specific
 * vault's own real owner() (a contract read), never merely "a wallet is
 * connected" — this page is public and view-only for everyone else.
 */
function ConsolePage() {
  const wallet = useWallet();
  const { status: walletStatus, address, connect } = wallet;
  const connected = walletStatus === "CONNECTED";
  const [repointing, setRepointing] = useState(false);
  const queryClient = useQueryClient();

  const list = useMarketVaultDirectory();
  const problems = useDirectoryProblems();
  const rows = list.status === "ready" ? list.data : [];

  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<Tab>("FILLS");

  const vault = rows[Math.min(selected, Math.max(0, rows.length - 1))] ?? null;
  const isVaultOwner = Boolean(
    connected && address && vault?.ownerAddress && vault.ownerAddress.toLowerCase() === address.toLowerCase(),
  );
  const capabilities = vaultCapabilitiesFromAbi(solverVaultAbi as unknown as ReadonlyArray<{ type: string; name?: string }>);

  /** D12: `setSettlementReceiver(<current>)` on this vault, signed by its owner. */
  async function repointSettlementReceiver() {
    if (!vault || !address) return;
    const target = chainConfig(vault.chainId)?.settlementReceiver ?? null;
    const publicClient = publicClientFor(vault.chainId);
    if (!target || !publicClient) return;
    setRepointing(true);
    try {
      await wallet.switchChain(vault.chainId);
      const walletClient = await wallet.getWalletClient(vault.chainId);
      const hash = await walletClient.writeContract({
        address: vault.vaultAddress,
        abi: solverVaultAbi,
        functionName: "setSettlementReceiver",
        args: [target],
        chain: viemChainFor(vault.chainId),
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success("Settlement receiver updated", { description: truncateAddress(target) });
      await queryClient.invalidateQueries({ queryKey: ["vault-directory"] });
    } catch (error) {
      toast.error("Could not update the settlement receiver", { description: error instanceof Error ? error.message : "Transaction failed." });
    } finally {
      setRepointing(false);
    }
  }
  const vaultUtilisation = useVaultAnalytics(vault?.chainId ?? 0, vault?.vaultAddress ?? null);
  // Telemetry first: its reported operator/online state feeds useSolverMetrics
  // below (WP-19.4's own rule — telemetry only ever supplies a *candidate*
  // operator to check onchain, never the authorisation fact itself).
  const telemetry = useSolverTelemetry(vault?.chainId ?? 0, vault?.vaultAddress ?? null);
  const metrics = useSolverMetrics(vault?.chainId ?? 0, vault?.vaultAddress ?? null, {
    candidateOperator: telemetry.status === "ready" ? telemetry.data.operatorAddress : null,
    telemetryOnline: telemetry.status === "ready" ? telemetry.data.online : null,
  });
  const fills = useVaultFills(vault?.chainId ?? 0, vault?.vaultAddress ?? null);
  const activity = useVaultActivity(vault?.chainId ?? 0, vault?.vaultAddress ?? null);

  // WP-19.3 — the onchain half of the orb's state machine: whatever intent
  // telemetry is currently reporting on, checked directly against the
  // indexer's own fills/settlements for a real, confirmed outcome. Always
  // wins over telemetry's own stage the instant it exists (see
  // deriveOnchainStage and SolverOrb's own merge).
  const activeIntentId = telemetry.status === "ready" ? telemetry.data.intentId : null;
  const intentOutcome = useIntentOutcome(vault?.chainId ?? 0, activeIntentId);
  const onchainStage = deriveOnchainStage(vault?.vaultAddress ?? null, intentOutcome);

  const authState: SolverAuthState | null = metrics.status === "ready" ? metrics.data.authState : null;
  const runtimeStatus: SolverRuntimeStatus | null =
    metrics.status === "ready" ? metrics.data.runtimeStatus : null;
  const authorisedSolver = metrics.status === "ready" ? metrics.data.authorisedSolver : null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <p className="num text-xs uppercase tracking-[0.3em] text-acid">Solver console</p>
      <h1 className="font-display text-4xl uppercase text-newsprint sm:text-5xl">The market, live</h1>
      <p className="measure mt-2 text-sm text-text-dim">
        Every vault currently competing in the intent market, on both chains — a public, view-only
        window onto the market's activity. Connect the wallet that owns a vault to see its owner controls;
        watching does not require it.
      </p>

      {!vault ? (
        <section className="panel mt-8">
          <StateSection
            state={list}
            emptyTitle="No vaults yet"
            emptyNote="No vault has deployed or won a fastFill on either chain yet."
            unavailableTitle="Not available yet"
            action={
              <Link
                to="/earn"
                className="inline-block rounded-lg border border-acid/60 bg-acid/15 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-acid"
              >
                Deploy a vault
              </Link>
            }
          >
            {() => null}
          </StateSection>
        </section>
      ) : (
        <>
          {problems.length > 0 ? (
            <p className="mt-6 rounded-md border border-warning/50 bg-warning/5 px-3 py-2 text-xs text-warning">
              Could not read one chain's vault directory — showing the rest. {problems.map((p) => p.split("\n")[0]).join(" · ")}
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <p className="num text-xs uppercase tracking-wide text-text-dim">
              {rows.length} vault{rows.length === 1 ? "" : "s"} in the market
              {connected && address ? ` · viewing as ${truncateAddress(address)}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {rows.map((v, i) => (
                <button
                  key={`${v.chainId}:${v.vaultAddress}`}
                  type="button"
                  onClick={() => setSelected(i)}
                  aria-pressed={i === selected}
                  className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors ${
                    i === selected
                      ? "border-acid/60 bg-acid/15 text-acid"
                      : "border-border text-text-dim hover:text-text"
                  }`}
                >
                  {v.operatorLabel ?? truncateAddress(v.vaultAddress)} · {CHAINS[v.chainId]?.short}
                </button>
              ))}
            </div>
          </div>

          <section className="panel mt-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-2xl uppercase text-newsprint">
                {vault.operatorLabel ?? truncateAddress(vault.vaultAddress)}
              </h2>
              <ChainBadge chainId={vault.chainId} />
              <AuthChip authState={authState} />
              <RuntimeChip runtime={runtimeStatus} />
              <span className="num ml-auto text-xs text-text-dim">
                Vault <CopyValue value={vault.vaultAddress} label="vault address" />
              </span>
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                k="Settled volume (USD)"
                tone="text-text"
                slot={<StateValue state={metrics} format={(m) => (m.totalVolume === null ? NOT_AVAILABLE : formatUsdc(m.totalVolume))} />}
              />
              <Metric
                k="Fees earned"
                tone="text-acid"
                slot={<StateValue state={metrics} format={(m) => (m.totalFees === null ? NOT_AVAILABLE : `${formatUsdc(m.totalFees)} USDC`)} />}
              />
              <Metric
                k="Successful fills"
                tone="text-text"
                slot={<StateValue state={metrics} format={(m) => (m.transactionCount === null ? NOT_AVAILABLE : `${m.transactionCount}`)} />}
              />
              <Metric
                k="Avg settlement time"
                tone="text-gold-glow"
                slot={
                  <StateValue
                    state={metrics}
                    format={(m) =>
                      m.averageSettlementSeconds === null ? NOT_AVAILABLE : formatDuration(m.averageSettlementSeconds)
                    }
                  />
                }
              />
              <Metric
                k="Available liquidity"
                tone="text-text"
                slot={
                  <StateValue
                    state={metrics}
                    format={(m) => (m.availableLiquidity === null ? NOT_AVAILABLE : `${formatUsdc(m.availableLiquidity)} USDC`)}
                  />
                }
              />
              <Metric
                k="Outstanding exposure"
                tone="text-gold-glow"
                slot={
                  <StateValue
                    state={metrics}
                    format={(m) => (m.outstandingExposure === null ? NOT_AVAILABLE : `${formatUsdc(m.outstandingExposure)} USDC`)}
                  />
                }
              />
              <Metric
                k="Utilisation"
                tone="text-electric-glow"
                slot={<StateValue state={metrics} format={(m) => (m.utilisationBps === null ? NOT_AVAILABLE : formatBps(m.utilisationBps))} />}
              />
              <Metric
                k="Solver heartbeat"
                tone="text-text-dim"
                slot={
                  <StateValue
                    state={telemetry}
                    format={(t) =>
                      t.lastHeartbeatAt === null ? (
                        <span className="num text-base text-text-dim">{NOT_AVAILABLE}</span>
                      ) : (
                        <TimeValue at={t.lastHeartbeatAt} className="num text-base text-text-dim" />
                      )
                    }
                  />
                }
              />
            </dl>
            <div className="mt-3">
              <UtilisationMeter bps={metrics.status === "ready" ? metrics.data.utilisationBps : null} />
            </div>

            <div className="instrument mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 p-3">
              <p className="num text-xs text-text-dim">
                Authorised solver operator{" "}
                {authorisedSolver ? (
                  <CopyValue value={authorisedSolver} label="solver operator address" />
                ) : (
                  <span className="text-text-dim/70">{NOT_AVAILABLE}</span>
                )}
              </p>
              <p className="num text-xs text-text-dim">
                Owner{" "}
                {vault.ownerAddress ? (
                  <CopyValue value={vault.ownerAddress} label="vault owner address" />
                ) : (
                  <span className="text-text-dim/70">{NOT_AVAILABLE}</span>
                )}
              </p>
            </div>
            <AwaitingSource>
              Vault state from contract reads · volume, fees and latency from indexed winning fills
            </AwaitingSource>
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="panel p-5">
              <SolverOrb
                telemetry={telemetry}
                runtimeStatus={runtimeStatus}
                authState={authState}
                onchainStage={onchainStage}
              />
            </section>
            <VaultUtilisationChart state={vaultUtilisation} />
          </div>

          <div className="mt-6">
            <VaultFeeTierChart state={vaultUtilisation} />
          </div>

          {vault.settlementReceiverCurrent === false ? (
            <section className="panel mt-6 flex flex-wrap items-center gap-4 border-warning/50 p-5">
              <p className="measure text-sm text-text-dim">
                <span className="font-semibold text-warning">Settlement receiver out of date.</span> This vault still expects
                canonical settlement from {vault.settlementReceiver ? truncateAddress(vault.settlementReceiver) : "an old receiver"};
                the protocol now settles through {truncateAddress(chainConfig(vault.chainId)?.settlementReceiver ?? "0x")}. Until its
                owner re-points it, fills it wins will not be reimbursed.
              </p>
              {isVaultOwner ? (
                <button
                  type="button"
                  disabled={repointing}
                  onClick={() => void repointSettlementReceiver()}
                  className="ml-auto rounded-lg border border-acid/60 bg-acid/15 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-acid disabled:opacity-50"
                >
                  {repointing ? "Signing…" : "Update settlement receiver (one signature)"}
                </button>
              ) : null}
            </section>
          ) : null}

          {isVaultOwner ? (
            <OwnerControls capabilities={capabilities} />
          ) : (
            <section className="panel mt-6 flex flex-wrap items-center gap-4 p-5">
              <p className="measure text-sm text-text-dim">
                {connected
                  ? "This isn't your vault — it's shown here because it's part of the market. Owner controls only appear for the wallet that actually owns it."
                  : "Owner controls — pause, revoke or replace the authorised solver — appear once you connect the wallet that owns this vault."}
              </p>
              {!connected ? (
                <button
                  type="button"
                  onClick={() => connect()}
                  className="ml-auto rounded-lg border border-acid/60 bg-acid/15 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-acid"
                >
                  Connect wallet
                </button>
              ) : null}
            </section>
          )}

          <section className="panel mt-6 p-5">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["FILLS", "Successful fills"],
                  ["ACTIVITY", "Activity"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-pressed={tab === key}
                  className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors ${
                    tab === key
                      ? "border-acid/60 bg-acid/15 text-acid"
                      : "border-border text-text-dim hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "FILLS" ? (
              <>
                <h2 className="font-display mt-4 text-2xl uppercase text-newsprint">Successful fills</h2>
                <p className="mt-1 text-sm text-text-dim">
                  Realised performance only. Fast fill and canonical settlement stay separate facts.
                </p>
                <FillsTable state={fills} />
              </>
            ) : (
              <>
                <h2 className="font-display mt-4 text-2xl uppercase text-newsprint">Activity</h2>
                <p className="mt-1 text-sm text-text-dim">
                  Lost races, reverted attempts and policy rejections, kept out of realised performance.
                </p>
                <StateSection
                  state={activity}
                  emptyTitle="No activity yet"
                  emptyNote="Unrealised attempts appear here once the solver competes for an intent."
                  unavailableTitle="No activity yet"
                  unavailableNote="Activity comes from the indexer, which is not connected yet."
                >
                  {(data) => <ActivityTable rows={data} />}
                </StateSection>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ k, tone, slot }: { k: string; tone: string; slot: ReactNode }) {
  return (
    <div className="instrument p-3">
      <dt className="text-[11px] uppercase tracking-wide text-text-dim">{k}</dt>
      <dd className={`num mt-1 text-base ${tone}`}>{slot}</dd>
    </div>
  );
}

function AuthChip({ authState }: { authState: SolverAuthState | null }) {
  if (authState === null) {
    return (
      <span
        title="Authorisation state not readable yet"
        className="num rounded-sm border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-dim/70"
      >
        Authorisation {NOT_AVAILABLE}
      </span>
    );
  }
  const authorised = authState === "AUTHORISED";
  return (
    <span
      className={`num rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        authorised ? "border-acid/60 bg-acid/10 text-acid" : "border-warning/50 bg-warning/10 text-warning"
      }`}
    >
      {authorised ? "Solver authorised" : `Solver ${authState.toLowerCase()}`}
    </span>
  );
}

function RuntimeChip({ runtime }: { runtime: SolverRuntimeStatus | null }) {
  if (runtime === null) {
    return (
      <span className="num rounded-sm border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-dim/70">
        Runtime {NOT_AVAILABLE}
      </span>
    );
  }
  const style =
    runtime === "ONLINE"
      ? "border-success/50 bg-success/10 text-success"
      : runtime === "PAUSED"
        ? "border-warning/50 bg-warning/10 text-warning"
        : "border-border bg-surface-raised text-text-dim";
  return (
    <span className={`num rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style}`}>
      {runtime === "ONLINE" ? "Online" : runtime === "PAUSED" ? "Paused" : "Offline"}
    </span>
  );
}

/**
 * Only rendered for capabilities the deployed vault ABI exposes.
 * WIRE: each button becomes an owner-signed transaction against the vault.
 */
function OwnerControls({ capabilities }: { capabilities: Record<VaultCapability, boolean> | null }) {
  if (!capabilities) {
    return (
      <section className="panel mt-6 p-5">
        <h2 className="font-display text-2xl uppercase text-newsprint">Owner controls</h2>
        <p className="measure mt-1 text-sm text-text-dim">
          Pause, revoke and replace appear once the deployed vault ABI is known — the frontend does not
          assume a vault supports them.
        </p>
        <AwaitingSource>Awaiting vault ABI capability read</AwaitingSource>
      </section>
    );
  }
  const { pause, revokeSolver, replaceSolver } = capabilities;
  if (!pause && !revokeSolver && !replaceSolver) return null;
  return (
    <section className="panel mt-6 p-5">
      <h2 className="font-display text-2xl uppercase text-newsprint">Owner controls</h2>
      <p className="measure mt-1 text-sm text-text-dim">
        Signed by your owner wallet. Each action is an onchain transaction against your vault; only the
        controls your vault ABI supports are shown.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {pause ? (
          <button
            type="button"
            className="rounded-lg border border-warning/60 bg-warning/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-warning"
          >
            Pause solver / vault
          </button>
        ) : null}
        {revokeSolver ? (
          <button
            type="button"
            className="rounded-lg border border-pink/60 bg-pink/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-pink"
          >
            Revoke solver authorisation
          </button>
        ) : null}
        {replaceSolver ? (
          <Link
            to="/earn"
            className="rounded-lg border border-acid/60 bg-acid/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-acid"
          >
            Replace authorised solver
          </Link>
        ) : null}
      </div>
    </section>
  );
}

const OUTCOME_STYLE: Record<ActivityRow["outcome"], string> = {
  LOST_RACE: "border-pink/50 bg-pink/10 text-pink",
  REVERTED: "border-warning/50 bg-warning/10 text-warning",
  REJECTED_BY_POLICY: "border-border bg-surface-raised text-text-dim",
  EXPIRED: "border-border bg-surface-raised text-text-dim",
};

const OUTCOME_LABEL: Record<ActivityRow["outcome"], string> = {
  LOST_RACE: "Lost race",
  REVERTED: "Reverted",
  REJECTED_BY_POLICY: "Policy reject",
  EXPIRED: "Expired",
};

function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">Opportunities this solver did not realise</caption>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-text-dim">
            <th className="pb-2 font-medium">Intent</th>
            <th className="pb-2 font-medium">Route</th>
            <th className="pb-2 font-medium">Amount</th>
            <th className="pb-2 font-medium">Outcome</th>
            <th className="pb-2 font-medium">Detail</th>
            <th className="pb-2 font-medium">When</th>
            <th className="pb-2 font-medium">Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = r.txHash ? explorerTxUrl(r.destinationChainId, r.txHash) : null;
            return (
              <tr key={r.intentId} className="border-t border-border/60">
                <td className="num py-2.5 text-text-dim">{truncateAddress(r.intentId, 8, 4)}</td>
                <td className="py-2.5">
                  <span className="flex items-center gap-1.5">
                    <ChainBadge chainId={r.sourceChainId} />
                    <span className="text-text-dim">→</span>
                    <ChainBadge chainId={r.destinationChainId} />
                  </span>
                </td>
                <td className="num py-2.5 text-text">{formatUsdc(r.amount)}</td>
                <td className="py-2.5">
                  <span
                    className={`num rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${OUTCOME_STYLE[r.outcome]}`}
                  >
                    {OUTCOME_LABEL[r.outcome]}
                  </span>
                </td>
                <td className="py-2.5 text-text-dim">{r.detail}</td>
                <td className="num py-2.5 text-text-dim">
                  <TimeValue at={r.at} />
                </td>
                <td className="num py-2.5">
                  {href ? (
                    <a className="text-electric-glow hover:text-acid" href={href} target="_blank" rel="noreferrer">
                      tx
                    </a>
                  ) : (
                    NOT_AVAILABLE
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
