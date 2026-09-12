import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { decodeEventLog, encodeEventTopics, keccak256, toHex } from "viem";
import { InvalidFeePolicyError, feeBpsAt, validateFeePolicy, type FeePolicy } from "@arcaidia/domain";
import { erc20Abi, solverVaultAbi, vaultFactoryAbi } from "@/lib/arcaidia/abis";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";
import { viemChainFor } from "@/lib/arcaidia/viem-chains";
import { toast } from "sonner";
import { CopyValue } from "@/components/site/copy-value";
import { TimeValue } from "@/components/site/time-value";
import { ARC_TESTNET, CHAINS, ETHEREUM_SEPOLIA, type Address, type SolverDeployTarget } from "@/lib/arcaidia/types";
import { formatBps, formatUsdc, isAddressLike, parseUsdc, truncateAddress } from "@/lib/arcaidia/format";
import { ChainBadge, FillsTable, UtilisationMeter } from "@/components/vaults/vault-bits";
import { useWallet } from "@/components/wallet/wallet-context";
import { chainConfig, SERVICES } from "@/lib/arcaidia/config";
import { NOT_AVAILABLE } from "@/lib/arcaidia/data-state";
import { AwaitingSource, StateValue } from "@/components/data/state-views";
import { useSolverMetrics } from "@/hooks/arcaidia/use-solver-metrics";
import { useSolverTelemetry } from "@/hooks/arcaidia/use-solver-telemetry";
import { useVaultFills } from "@/hooks/arcaidia/use-vault-fills";


export const Route = createFileRoute("/earn")({
  head: () => ({
    meta: [
      { title: "Earn — deploy a solver vault | Arcaidia" },
      {
        name: "description",
        content:
          "Deploy your own Arcaidia solver vault: choose a chain, fund it with USDC, set its economics, connect a solver and go live competing for the first valid fill.",
      },
      { property: "og:title", content: "Earn — deploy a solver vault | Arcaidia" },
      {
        property: "og:description",
        content:
          "An operator console for running an autonomous liquidity business: your vault, your capital, your fee curve.",
      },
    ],
  }),
  component: EarnPage,
});

const STEPS = [
  { n: 1, label: "Choose chain" },
  { n: 2, label: "Create vault" },
  { n: 3, label: "Fund vault" },
  { n: 4, label: "Set up solver" },
  { n: 5, label: "Go live" },
] as const;

type SolverMode = "REFERENCE" | "EXTERNAL";

/**
 * Reference solver recipes — only what actually exists today. There is no
 * published image, installer or Helm chart; the reference solver is
 * `packages/agent` in this repository, run either through the committed
 * Docker Compose stack (WP-17.3, `docker-compose.yml`) or straight from a
 * checkout with `pnpm solver:start`. Every command below was run as written.
 * The solver owns its operator key, not Arcaidia.
 */
const DEPLOY_TARGETS: Array<{ id: SolverDeployTarget; label: string; command: string }> = [
  {
    id: "DOCKER",
    label: "Docker Compose",
    command: `git clone https://github.com/immaxkent/arcaidia.git && cd arcaidia
cp .env.example .env
# paste the runtime config below into .env, then add your own
# LOCAL_AGENT_PRIVATE_KEY and LOCAL_SUBMITTER_PRIVATE_KEY
docker compose up --build -d
docker compose logs -f arcaidia-solver

# prints: [solver] signer 0x… — that is the operator address to authorise below`,
  },
  {
    id: "NODE",
    label: "Node (pnpm)",
    command: `git clone https://github.com/immaxkent/arcaidia.git && cd arcaidia
pnpm install
cp .env.example .env
# paste the runtime config below into .env, then add your own
# LOCAL_AGENT_PRIVATE_KEY and LOCAL_SUBMITTER_PRIVATE_KEY
pnpm solver:start

# prints: [solver] signer 0x… — that is the operator address to authorise below`,
  },
];

/** Matches `CHAIN_ENV_PREFIX` in packages/agent/src/entrypoint/config.ts exactly. */
const CHAIN_ENV_PREFIX: Record<number, string> = {
  [ETHEREUM_SEPOLIA]: "ETHEREUM_SEPOLIA",
  [ARC_TESTNET]: "ARC_TESTNET",
};

/**
 * WP-19.1 — the non-secret runtime config block for the vault this wallet
 * just deployed, in the shape `.env.example` and the reference Docker
 * Compose stack (WP-17.3) actually read, not an idealised placeholder.
 *
 * Deliberately omits the solver's own operator keys — `LOCAL_AGENT_PRIVATE_KEY`
 * / `LOCAL_SUBMITTER_PRIVATE_KEY` are the operator's own, set in the solver's
 * `.env` (see `.env.example`; `packages/agent/src/entrypoint/config.ts` reads
 * them and never generates them). This page never sees or emits them.
 *
 * Also deliberately omits `SUBGRAPH_URL_{PREFIX}` (WP-22): unset already
 * means "use Arcaidia's own shared, unlimited indexer" — the actual gap
 * WP-22 closed was operators needing their own Graph account/key at all, so
 * handing back an indexer URL here would silently reintroduce the thing that
 * config was designed to make unnecessary. Shown only as a commented-out
 * example for an operator who wants their own indexer instead.
 */
export function runtimeConfigText(chainId: number, vaultAddress: Address, telemetryUrl: string | null): string {
  const prefix = CHAIN_ENV_PREFIX[chainId] ?? "UNKNOWN_CHAIN";
  return `# Arcaidia solver runtime config — generated for your vault.
# Set these in the reference solver's .env (see .env.example), or as
# container env vars for any other deployment target.
#
# LOCAL_AGENT_PRIVATE_KEY / LOCAL_SUBMITTER_PRIVATE_KEY are yours to add in
# the same .env — the signer produces fill authorisations, the submitter pays
# gas to broadcast them (see .env.example). This page never sees or emits them.

${prefix}_LIQUIDITY_VAULT=${vaultAddress}

# Unset ${prefix}_RPC_URL to use the public default RPC endpoint. Set it only
# if you want your own (a private/paid RPC, or your own node).
# ${prefix}_RPC_URL=

# Unset means "use Arcaidia's own shared, unlimited indexer" — no Graph
# account or API key needed. Set only to point this solver at your own
# subgraph or indexer instead.
# SUBGRAPH_URL_${prefix}=

TELEMETRY_ENABLED=true
ARCAIDIA_TELEMETRY_URL=${telemetryUrl ?? "# not configured for this deployment yet"}
`;
}

/**
 * HANDOFF — Earn / operator flow.
 *
 * Every step state comes from a real action, never assumed:
 *   wallet connected      -> useWallet (Privy)
 *   vault deployed        -> factory tx receipt; `vaultAddress` stays null until then
 *   funding confirmed     -> USDC transfer receipt
 *   solver operator known -> pasted by the owner / reported by telemetry pairing
 *   authorised onchain    -> useSolverMetrics().authState (contract read)
 *   solver live           -> telemetry heartbeat, which is NOT authorisation
 * Vault health and fills read from contract/indexer hooks and show honest
 * unavailable states until those are wired.
 */
function EarnPage() {
  const wallet = useWallet();
  const { status: walletStatus, address, connect } = wallet;
  const connected = walletStatus === "CONNECTED";

  const [step, setStep] = useState(1);
  const [chainId, setChainId] = useState(ARC_TESTNET);
  const [vaultName, setVaultName] = useState("");
  const [funding, setFunding] = useState("");
  // Fees are no longer a per-vault choice — the intent market enforces one
  // universal fee ceiling (ArcaidiaIntentMarket.MAX_FEE_BPS, WP-16) that every
  // vault charges under first-valid-fill, so a per-vault base fee / pricing
  // curve picker here would configure something the protocol doesn't read.
  // What a vault owner actually controls is risk exposure, not price:
  // maxFillBps caps any one fill as a percentage of the vault's own available
  // liquidity; maxExposureBps caps how much of the vault can be in flight at
  // once. Defaults match the vault contract's own committed defaults' intent
  // (conservative but real capacity), not an arbitrary UI default.
  const [maxFillBps, setMaxFillBps] = useState(5_000);
  const [maxExposureBps, setMaxExposureBps] = useState(9_000);
  const [solverMode, setSolverMode] = useState<SolverMode>("REFERENCE");
  const [deployTarget, setDeployTarget] = useState<SolverDeployTarget>("DOCKER");
  const [solverOperator, setSolverOperator] = useState("");

  /**
   * The vault's fee policy (D7) — four utilisation tiers, fixed at creation. Defaults are the
   * plan's House Vault proposal; the tier preview below is the same arithmetic the vault runs.
   */
  const [policy, setPolicy] = useState<FeePolicy>({
    baseFeeBps: 10,
    midFeeBps: 25,
    highFeeBps: 60,
    criticalFeeBps: 120,
    midThresholdBps: 5_000,
    highThresholdBps: 7_500,
    criticalThresholdBps: 9_000,
  });
  const policyError = useMemo(() => {
    try {
      validateFeePolicy(policy);
      return null;
    } catch (error) {
      return error instanceof InvalidFeePolicyError ? error.message : "Invalid fee policy.";
    }
  }, [policy]);
  const RESERVE_FLOOR_BPS = 1_000;

  /** Set only from a confirmed factory deployment receipt (`VaultCreated`). */
  const [vaultAddress, setVaultAddress] = useState<Address | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [authorising, setAuthorising] = useState(false);
  const [authoriseError, setAuthoriseError] = useState<string | null>(null);
  const deployed = vaultAddress !== null;
  const factory = chainConfig(chainId)?.vaultFactory ?? null;
  const factoryReady = factory !== null;

  /** The real thing: `ArcaidiaVaultFactory.createVault(...)`, owner-signed through Privy. */
  async function deployVault() {
    if (!connected || !address || !factory) return;
    const publicClient = publicClientFor(chainId);
    if (!publicClient) {
      setDeployError("RPC is not configured for this chain yet.");
      return;
    }
    setDeployError(null);
    setDeploying(true);
    try {
      const walletClient = await wallet.getWalletClient(chainId);
      const salt = keccak256(toHex(`${vaultName.trim()}:${Date.now()}`));
      const hash = await walletClient.writeContract({
        address: factory,
        abi: vaultFactoryAbi,
        functionName: "createVault",
        args: [salt, RESERVE_FLOOR_BPS, maxFillBps, maxExposureBps, policy, vaultName.trim()],
        chain: viemChainFor(chainId),
        account: address,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const [topic] = encodeEventTopics({ abi: vaultFactoryAbi, eventName: "VaultCreated" });
      const log = receipt.logs.find(
        (l) => l.address.toLowerCase() === factory.toLowerCase() && l.topics[0] === topic,
      );
      if (!log) {
        setDeployError("Transaction confirmed but no VaultCreated event was found.");
        return;
      }
      const decoded = decodeEventLog({ abi: vaultFactoryAbi, data: log.data, topics: log.topics, eventName: "VaultCreated" });
      setVaultAddress(decoded.args.vault);
      toast.success("Vault created", { description: decoded.args.vault });
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      setDeploying(false);
    }
  }

  const [depositing, setDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositedTotal, setDepositedTotal] = useState<bigint>(0n);

  /** ERC-4626 `deposit` into the operator's own vault: approve USDC, then deposit, both owner-signed. */
  async function depositUsdc() {
    if (!connected || !address || !vaultAddress) return;
    const config = chainConfig(chainId);
    const publicClient = publicClientFor(chainId);
    const amount = parseUsdc(funding);
    if (!config?.usdc || !publicClient) {
      setDepositError("USDC / RPC not configured for this chain yet.");
      return;
    }
    if (!amount || amount <= 0n) {
      setDepositError("Enter an amount.");
      return;
    }
    setDepositError(null);
    setDepositing(true);
    try {
      const walletClient = await wallet.getWalletClient(chainId);
      const chain = viemChainFor(chainId);
      const allowance = await publicClient.readContract({
        address: config.usdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, vaultAddress],
      });
      if (allowance < amount) {
        const approveHash = await walletClient.writeContract({
          address: config.usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [vaultAddress, amount],
          chain,
          account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      const hash = await walletClient.writeContract({
        address: vaultAddress,
        abi: solverVaultAbi,
        functionName: "deposit",
        args: [amount, address],
        chain,
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setDepositedTotal((t) => t + amount);
      toast.success("Deposited", { description: `${formatUsdc(amount)} USDC into ${truncateAddress(vaultAddress)}` });
    } catch (error) {
      setDepositError(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      setDepositing(false);
    }
  }

  /** `setAuthorisedSigner(operator, true)` — the owner's own call on their own vault. */
  async function authoriseSolver() {
    if (!connected || !address || !vaultAddress || !operatorValid) return;
    const publicClient = publicClientFor(chainId);
    if (!publicClient) {
      setAuthoriseError("RPC is not configured for this chain yet.");
      return;
    }
    setAuthoriseError(null);
    setAuthorising(true);
    try {
      const walletClient = await wallet.getWalletClient(chainId);
      const hash = await walletClient.writeContract({
        address: vaultAddress,
        abi: solverVaultAbi,
        functionName: "setAuthorisedSigner",
        args: [solverOperator.trim() as Address, true],
        chain: viemChainFor(chainId),
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success("Solver authorised", { description: truncateAddress(solverOperator.trim() as Address) });
    } catch (error) {
      setAuthoriseError(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      setAuthorising(false);
    }
  }

  const vaultNameValid = vaultName.trim().length > 0;
  // A step is reachable by clicking its own tab only once every step before
  // it is satisfied — Back is always free, but skipping ahead of the
  // furthest-completed step is not, so a vault's name/economics are always
  // captured before anything downstream (fund, authorise) can read them.
  // `Next` and the tabs share this one gate.
  const maxReachableStep = vaultNameValid ? 5 : 2;

  const operatorValid = isAddressLike(solverOperator.trim());

  // Telemetry first: its reported operator/online state feeds useSolverMetrics
  // below (WP-19.4's own rule — telemetry only ever supplies a *candidate*
  // operator to check onchain, never the authorisation fact itself). The
  // owner's own typed address takes priority once it's a well-formed
  // address — it's what they're about to authorise, telemetry pairing (if
  // any) is what the runtime has already reported on its own.
  const telemetry = useSolverTelemetry(chainId, vaultAddress);
  const candidateOperator = operatorValid
    ? (solverOperator.trim() as Address)
    : telemetry.status === "ready"
      ? telemetry.data.operatorAddress
      : null;
  const metrics = useSolverMetrics(chainId, vaultAddress, {
    candidateOperator,
    telemetryOnline: telemetry.status === "ready" ? telemetry.data.online : null,
  });
  const fills = useVaultFills(chainId, vaultAddress);

  const authorised = metrics.status === "ready" && metrics.data.authState === "AUTHORISED";
  const live = metrics.status === "ready" && metrics.data.runtimeStatus === "ONLINE";

  const funded = parseUsdc(funding) ?? 0n;
  const reserveFloor = funded / 10n;
  const usable = funded - reserveFloor;


  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <p className="num text-xs uppercase tracking-[0.3em] text-acid">Operator console</p>
      <h1 className="font-display text-4xl uppercase text-newsprint sm:text-5xl">Earn — run a solver vault</h1>
      <p className="measure mt-2 text-sm text-text-dim">
        This is not a staking page. You deploy a vault you control, fund it with your own USDC, set the price
        you are willing to advance liquidity at, and point a solver at the intent stream. When your solver
        lands the first valid fill, your vault pays the recipient and earns the fee; canonical CCTP settlement
        reimburses it later. Your capital is at risk while a fill is outstanding.
      </p>
      <p className="measure mt-2 text-sm text-text-dim">
        There are no pooled third-party deposits. Nobody LPs into your vault, and you do not LP into anyone
        else's.
      </p>

      <ol className="mt-8 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {STEPS.map((s) => {
          const state = s.n === step ? "current" : s.n < step ? "done" : "todo";
          // Only a step already reached is clickable directly — jumping
          // ahead has to go through Next, one step at a time, so a step's
          // own required data is always captured before anything past it
          // can read it.
          const reachable = s.n <= step;
          return (
            <li key={s.n}>
              <button
                type="button"
                onClick={() => reachable && setStep(s.n)}
                disabled={!reachable}
                aria-current={state === "current"}
                aria-disabled={!reachable}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs uppercase tracking-wide transition-colors ${
                  state === "current"
                    ? "border-acid/70 bg-acid/10 text-acid"
                    : state === "done"
                      ? "border-gold/40 bg-gold/5 text-gold-glow"
                      : "border-border text-text-dim"
                } ${reachable ? "hover:text-text" : "cursor-not-allowed opacity-50"}`}
              >
                <span className="num block text-[10px] opacity-70">Step {s.n}</span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(360px,1fr)_minmax(340px,420px)]">
        <section className="panel p-5">
          {step === 1 ? (
            <Step title="Choose destination chain" hint="Your vault advances liquidity on this chain.">
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[ETHEREUM_SEPOLIA, ARC_TESTNET].map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setChainId(id)}
                    aria-pressed={id === chainId}
                    className={`instrument p-4 text-left transition-colors ${
                      id === chainId ? "border-acid/60" : ""
                    }`}
                  >
                    <span className="font-display text-2xl uppercase text-newsprint">{CHAINS[id]?.short}</span>
                    <span className="num mt-1 block text-[11px] text-text-dim">{CHAINS[id]?.name}</span>
                  </button>
                ))}
              </div>
            </Step>
          ) : null}

          {step === 2 ? (
            <Step
              title="Create vault"
              hint="Configure your vault, then deploy it from the supported factory template in one transaction. No custom vault code — economics below are set at deploy time, not editable after."
            >
              <Field label="Vault name" id="vault-name">
                <input
                  id="vault-name"
                  placeholder="e.g. Midnight Runner"
                  value={vaultName}
                  onChange={(e) => setVaultName(e.target.value)}
                  className="num w-full rounded-md border border-border bg-void px-3 py-2 text-sm text-text"
                />
              </Field>
              <p className="num mt-1 text-[11px] text-text-dim">
                A label for your own reference — carried through deploy, not read onchain.
              </p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row k="Template" v="ArcaidiaSolverVault (standard)" />
                <Row k="Chain" v={CHAINS[chainId]?.name ?? NOT_AVAILABLE} />
                <Row k="Asset" v="USDC" />
                <Row
                  k="Owner"
                  v={connected && address ? truncateAddress(address) : "Connect wallet"}
                  tone={connected ? "text-text" : "text-warning"}
                />
              </dl>

              {/* Risk exposure — the two caps, part of the same createVault transaction as the
                  fee policy below. Unlike the policy, the owner may adjust these later. */}
              <div className="mt-5 space-y-4 border-t border-border/60 pt-4">
                <p className="text-[11px] uppercase tracking-wide text-text-dim">Risk exposure</p>
                <Field label={`Max single fill — ${formatBps(maxFillBps)} of available liquidity`} id="max-fill-bps">
                  <input
                    id="max-fill-bps"
                    type="range"
                    min={500}
                    max={10_000}
                    step={100}
                    value={maxFillBps}
                    onChange={(e) => setMaxFillBps(Number(e.target.value))}
                    className="w-full accent-acid"
                  />
                </Field>
                <p className="num text-[11px] text-text-dim">
                  The largest share of your vault's *remaining* available liquidity any one fill may take.
                </p>
                <Field label={`Max utilisation — ${formatBps(maxExposureBps)}`} id="max-exposure-bps">
                  <input
                    id="max-exposure-bps"
                    type="range"
                    min={1_000}
                    max={9_800}
                    step={100}
                    value={maxExposureBps}
                    onChange={(e) => setMaxExposureBps(Number(e.target.value))}
                    className="w-full accent-acid"
                  />
                </Field>
                <p className="num text-[11px] text-text-dim">
                  The most of your vault's capital that may be in flight (advanced, awaiting canonical
                  settlement) at once.
                </p>
              </div>

              {/* Fee policy (D7): this vault's own price at each utilisation band, immutable once
                  created and enforced by the vault on chain — a solver can never charge above it. */}
              <div className="mt-5 space-y-3 border-t border-border/60 pt-4">
                <p className="text-[11px] uppercase tracking-wide text-text-dim">Fee policy — belongs to this vault, fixed at creation</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["baseFeeBps", "Base fee", `below ${formatBps(policy.midThresholdBps)} utilised`],
                      ["midFeeBps", "Mid fee", `from ${formatBps(policy.midThresholdBps)}`],
                      ["highFeeBps", "High fee", `from ${formatBps(policy.highThresholdBps)}`],
                      ["criticalFeeBps", "Critical fee", `from ${formatBps(policy.criticalThresholdBps)}`],
                    ] as const
                  ).map(([key, label, hint]) => (
                    <Field key={key} label={`${label} (bps)`} id={`policy-${key}`}>
                      <input
                        id={`policy-${key}`}
                        inputMode="numeric"
                        value={policy[key]}
                        onChange={(e) => setPolicy((p) => ({ ...p, [key]: Number(e.target.value) || 0 }))}
                        className="num w-full rounded-md border border-border bg-void px-3 py-2 text-sm text-text"
                      />
                      <span className="num block text-[10px] text-text-dim">{hint}</span>
                    </Field>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {(
                    [
                      ["midThresholdBps", "Mid threshold"],
                      ["highThresholdBps", "High threshold"],
                      ["criticalThresholdBps", "Critical threshold"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field key={key} label={`${label} (bps utilised)`} id={`policy-${key}`}>
                      <input
                        id={`policy-${key}`}
                        inputMode="numeric"
                        value={policy[key]}
                        onChange={(e) => setPolicy((p) => ({ ...p, [key]: Number(e.target.value) || 0 }))}
                        className="num w-full rounded-md border border-border bg-void px-3 py-2 text-sm text-text"
                      />
                    </Field>
                  ))}
                </div>
                {policyError ? (
                  <p className="num text-[11px] text-warning">{policyError}</p>
                ) : (
                  <p className="num text-[11px] text-text-dim" data-testid="policy-preview">
                    Preview: {[0, 2_500, 5_000, 7_500, 9_000, 10_000]
                      .map((u) => `${formatBps(u)} → ${formatBps(feeBpsAt(policy, u))}`)
                      .join(" · ")}
                  </p>
                )}
              </div>

              <dl className="mt-4 space-y-1.5 text-sm">
                <Row k="Reserve floor" v={formatBps(RESERVE_FLOOR_BPS)} />
                <Row k="Vault" v={vaultAddress ? truncateAddress(vaultAddress) : "Not deployed yet"} />
              </dl>
              <button
                type="button"
                disabled={!connected || !factoryReady || !vaultNameValid || policyError !== null || deploying || deployed}
                onClick={() => (connected ? void deployVault() : connect())}
                className="mt-4 w-full rounded-lg border border-acid/60 bg-acid/15 py-3 text-sm font-semibold uppercase tracking-wide text-acid disabled:opacity-50"
              >
                {deployed ? "Vault deployed" : deploying ? "Deploying…" : "Deploy vault"}
              </button>
              {deployError ? <p className="mt-2 text-xs text-warning">{deployError}</p> : null}
              {!connected ? (
                <button
                  type="button"
                  onClick={() => connect()}
                  className="num mt-2 text-[11px] uppercase tracking-wide text-electric-glow hover:text-acid"
                >
                  Connect wallet first
                </button>
              ) : null}
              {vaultAddress ? (
                <p className="num mt-3 text-xs text-text-dim">
                  Vault <CopyValue value={vaultAddress} label="vault address" />
                </p>
              ) : null}
              {!factoryReady ? (
                <AwaitingSource>Vault factory not deployed on this chain yet</AwaitingSource>
              ) : null}
            </Step>

          ) : null}

          {step === 3 ? (
            <Step title="Fund vault" hint="Deposit USDC. A reserve floor stays behind so the vault can always unwind.">
              <div className="panel-raised mt-3 px-3 py-3">
                <label htmlFor="fund-amount" className="text-[11px] uppercase tracking-wide text-text-dim">
                  Deposit amount
                </label>
                <div className="mt-1 flex items-baseline gap-2">
                  <input
                    id="fund-amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={funding}
                    onChange={(e) => setFunding(e.target.value)}
                    className="num w-full bg-transparent text-2xl text-text outline-none placeholder:text-text-dim/50"
                  />
                  <span className="num text-sm text-text-dim">USDC</span>
                </div>
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                <Row k="Reserve floor (10%)" v={`${formatUsdc(reserveFloor)} USDC`} />
                <Row k="Usable fill capital" v={`${formatUsdc(usable)} USDC`} tone="text-acid" />
              </dl>
              <button
                type="button"
                disabled={!connected || !deployed || depositing || !parseUsdc(funding)}
                onClick={() => void depositUsdc()}
                className="mt-4 w-full rounded-lg border border-acid/60 bg-acid/15 py-3 text-sm font-semibold uppercase tracking-wide text-acid disabled:opacity-50"
              >
                {depositing ? "Depositing…" : "Deposit USDC"}
              </button>
              {depositError ? <p className="mt-2 text-xs text-warning">{depositError}</p> : null}
              {!deployed ? (
                <p className="num mt-2 text-[11px] text-text-dim">Deploy the vault on step 2 first — deposits go to that address.</p>
              ) : depositedTotal > 0n ? (
                <p className="num mt-2 text-[11px] text-acid">Deposited this session: {formatUsdc(depositedTotal)} USDC</p>
              ) : null}
            </Step>
          ) : null}

          {step === 4 ? (
            <Step
              title="Set up solver"
              hint="Arcaidia does not validate or trust a solver binary. It validates the solver operator address you authorise onchain for your vault."
            >
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    { id: "REFERENCE" as SolverMode, t: "Arcaidia reference solver", d: "packages/agent from this repository — Docker Compose, or pnpm from a checkout." },
                    { id: "EXTERNAL" as SolverMode, t: "External solver", d: "Any compatible implementation, however you host it." },
                  ]
                ).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSolverMode(o.id)}
                    aria-pressed={solverMode === o.id}
                    className={`instrument p-4 text-left ${solverMode === o.id ? "border-acid/60" : ""}`}
                  >
                    <span className="block text-sm font-semibold text-text">{o.t}</span>
                    <span className="mt-1 block text-xs text-text-dim">{o.d}</span>
                  </button>
                ))}
              </div>

              {solverMode === "REFERENCE" ? (
                <div className="mt-5">
                  <p className="text-[11px] uppercase tracking-wide text-text-dim">Deployment target</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DEPLOY_TARGETS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setDeployTarget(t.id)}
                        aria-pressed={deployTarget === t.id}
                        className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors ${
                          deployTarget === t.id
                            ? "border-acid/60 bg-acid/15 text-acid"
                            : "border-border text-text-dim hover:text-text"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <pre className="num mt-3 overflow-x-auto rounded-md border border-border bg-void px-3 py-3 text-[11px] leading-relaxed text-text-dim">
                    {(DEPLOY_TARGETS.find((t) => t.id === deployTarget) ?? DEPLOY_TARGETS[0]!).command}
                  </pre>
                  <p className="measure mt-2 text-xs text-text-dim">
                    On start the solver prints the signer address derived from your own{" "}
                    <code className="num">LOCAL_AGENT_PRIVATE_KEY</code> — that is the operator address you authorise
                    below. The key stays with your solver process; Arcaidia and your Privy wallet never hold it.
                    A Circle Agent Wallet (set the four <code className="num">CIRCLE_*</code> vars instead) works here too.
                  </p>
                </div>
              ) : (
                <p className="measure mt-4 text-xs text-text-dim">
                  Run your own solver anywhere. It needs its own operator address — an EOA or a supported
                  Circle Agent Wallet — able to submit fast fills against your vault.
                </p>
              )}

              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wide text-text-dim">Runtime config</p>
                  {deployed ? (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(
                          runtimeConfigText(chainId, vaultAddress!, SERVICES.solverTelemetryUrl),
                        );
                        toast.success("Copied", { description: "Runtime config" });
                      }}
                      className="text-[10px] font-semibold uppercase tracking-wide text-electric-glow hover:text-electric"
                    >
                      Copy
                    </button>
                  ) : null}
                </div>
                {deployed ? (
                  <pre className="num mt-2 overflow-x-auto rounded-md border border-border bg-void px-3 py-3 text-[11px] leading-relaxed text-text-dim">
                    {runtimeConfigText(chainId, vaultAddress!, SERVICES.solverTelemetryUrl)}
                  </pre>
                ) : (
                  <p className="measure mt-2 text-xs text-text-dim">Deploy your vault first to generate this.</p>
                )}
                <p className="measure mt-2 text-xs text-text-dim">
                  Every field here is non-secret — safe to paste into a container's env or a .env file. No
                  Graph account or indexer of your own is required unless you want to use one.
                </p>
              </div>

              <Field label="Solver operator address" id="solver-operator">
                <input
                  id="solver-operator"
                  placeholder="0x…"
                  value={solverOperator}
                  onChange={(e) => setSolverOperator(e.target.value)}
                  className="num w-full rounded-md border border-border bg-void px-3 py-2 text-sm text-text"
                />
              </Field>
              <p className="num text-[11px] text-text-dim">
                {operatorValid
                  ? "Valid address"
                  : solverOperator.trim().length === 0
                    ? "Paste the address your solver printed"
                    : "Not a valid 20-byte address"}
              </p>

              <button
                type="button"
                disabled={!connected || !deployed || !operatorValid || authorised || authorising}
                onClick={() => void authoriseSolver()}
                className="mt-4 w-full rounded-lg border border-acid/60 bg-acid/15 py-3 text-sm font-semibold uppercase tracking-wide text-acid disabled:opacity-50"
              >
                {authorised ? "Solver authorised" : authorising ? "Signing…" : "Sign authorisation transaction"}
              </button>
              {authoriseError ? <p className="mt-2 text-xs text-warning">{authoriseError}</p> : null}
              <p className="num mt-2 text-[11px] text-text-dim">
                You sign as the vault owner through Privy. This writes the authorised operator to your vault.
              </p>

              <dl className="mt-4 space-y-1.5 text-sm">
                <Row
                  k="Vault"
                  v={deployed ? truncateAddress(vaultAddress!) : "Deploy vault first"}
                  tone={deployed ? "text-success" : "text-warning"}
                />
                <Row
                  k="Owner identity"
                  v={connected && address ? truncateAddress(address) : "Connect wallet"}
                  tone={connected ? "text-text" : "text-warning"}
                />
                <Row
                  k="Solver operator"
                  v={operatorValid ? truncateAddress(solverOperator as Address) : NOT_AVAILABLE}
                />
                <Row
                  k="Telemetry pairing"
                  v={
                    telemetry.status === "ready"
                      ? telemetry.data.paired
                        ? "Runtime paired (not authorisation)"
                        : "Runtime seen, unpaired"
                      : "Telemetry unavailable"
                  }
                  tone="text-text-dim"
                />
                <Row
                  k="Onchain authorisation state"
                  v={
                    metrics.status === "ready"
                      ? metrics.data.authState === "AUTHORISED"
                        ? "SOLVER AUTHORISED"
                        : (metrics.data.authState ?? NOT_AVAILABLE)
                      : NOT_AVAILABLE
                  }
                  tone={authorised ? "text-acid" : "text-text-dim"}
                />
              </dl>
              <AwaitingSource>
                Authorisation state is read from the vault contract — telemetry pairing never implies it
              </AwaitingSource>
              <Link
                to="/console"
                className="mt-4 inline-block rounded-lg border border-electric/60 bg-electric/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-electric-glow"
              >
                Open solver console
              </Link>
            </Step>

          ) : null}

          {step === 5 ? (
            <Step title="Go live" hint="Review, then activate. You can pause the vault at any time.">
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row k="Name" v={vaultNameValid ? vaultName.trim() : NOT_AVAILABLE} />
                <Row k="Chain" v={CHAINS[chainId]?.name ?? NOT_AVAILABLE} />
                <Row k="Vault" v={deployed ? truncateAddress(vaultAddress!) : "Not deployed"} />
                <Row k="Funded" v={`${formatUsdc(funded)} USDC`} />
                <Row k="Max single fill" v={`${formatBps(maxFillBps)} of available liquidity`} />
                <Row k="Max utilisation" v={formatBps(maxExposureBps)} />
                <Row k="Solver runtime" v={solverMode === "REFERENCE" ? "Arcaidia reference solver" : "External solver"} />
                <Row
                  k="Authorised operator"
                  v={
                    metrics.status === "ready" && metrics.data.authorisedSolver
                      ? truncateAddress(metrics.data.authorisedSolver)
                      : NOT_AVAILABLE
                  }
                  tone={authorised ? "text-acid" : "text-text-dim"}
                />
              </dl>
              {/* WIRE: owner-signed activate/pause transaction on the vault. */}
              <button
                type="button"
                disabled={!authorised}
                className="mt-4 w-full rounded-lg border border-acid/60 bg-acid/15 py-3 text-sm font-semibold uppercase tracking-wide text-acid disabled:opacity-50"
              >
                {live ? "Pause solver" : "Activate solver"}
              </button>

              <p className="measure mt-3 text-xs text-text-dim">
                The solver operator address is replaceable at any time — the vault is the durable economic
                identity, and its history stays with it.
              </p>
              <Link
                to="/console"
                className="mt-4 inline-block rounded-lg border border-electric/60 bg-electric/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-electric-glow"
              >
                Open solver console
              </Link>
            </Step>
          ) : null}

          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="rounded-md border border-border px-3 py-2 text-xs uppercase tracking-wide text-text-dim hover:text-text"
            >
              Back
            </button>
            <button
              type="button"
              disabled={step >= maxReachableStep}
              onClick={() => setStep((s) => Math.min(maxReachableStep, s + 1))}
              className="rounded-md border border-acid/60 bg-acid/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-acid disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next step
            </button>
            {step === 2 && !vaultNameValid ? (
              <p className="num self-center text-[11px] text-warning">Name your vault to continue</p>
            ) : null}
          </div>
        </section>

        <aside className="panel p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl uppercase text-newsprint">Vault health</h2>
            <span
              className={`num rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                live ? "border-success/50 bg-success/10 text-success" : "border-border bg-surface-raised text-text-dim"
              }`}
            >
              {live ? "Live" : "Standby"}
            </span>
            <ChainBadge chainId={chainId} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            {(
              [
                {
                  k: "Available capital",
                  tone: "text-text",
                  f: (m: { availableLiquidity: bigint | null }) =>
                    m.availableLiquidity === null ? NOT_AVAILABLE : formatUsdc(m.availableLiquidity),
                },
                {
                  k: "Outstanding exposure",
                  tone: "text-gold-glow",
                  f: (m: { outstandingExposure: bigint | null }) =>
                    m.outstandingExposure === null ? NOT_AVAILABLE : formatUsdc(m.outstandingExposure),
                },
                {
                  k: "Successful fills",
                  tone: "text-electric-glow",
                  f: (m: { transactionCount: number | null }) =>
                    m.transactionCount === null ? NOT_AVAILABLE : `${m.transactionCount}`,
                },
                {
                  k: "Lifetime fees",
                  tone: "text-acid",
                  f: (m: { totalFees: bigint | null }) =>
                    m.totalFees === null ? NOT_AVAILABLE : formatUsdc(m.totalFees),
                },
                {
                  k: "Settled volume",
                  tone: "text-text",
                  f: (m: { totalVolume: bigint | null }) =>
                    m.totalVolume === null ? NOT_AVAILABLE : formatUsdc(m.totalVolume),
                },
                {
                  k: "Utilisation",
                  tone: "text-text",
                  f: (m: { utilisationBps: number | null }) =>
                    m.utilisationBps === null ? NOT_AVAILABLE : formatBps(m.utilisationBps),
                },
              ] as const
            ).map((m) => (
              <div key={m.k} className="instrument p-3">
                <dt className="text-[11px] uppercase tracking-wide text-text-dim">{m.k}</dt>
                <dd className={`num mt-1 text-base ${m.tone}`}>
                  <StateValue state={metrics} format={m.f} />
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-3">
            <UtilisationMeter bps={metrics.status === "ready" ? metrics.data.utilisationBps : null} />
          </div>
          <div className="instrument mt-4 p-3">
            <p className="text-[11px] uppercase tracking-wide text-text-dim">Solver status</p>
            <p className="num mt-1 text-sm text-text">
              {metrics.status === "ready" && metrics.data.runtimeStatus
                ? metrics.data.runtimeStatus
                : "Awaiting solver"}
            </p>
            <p className="num mt-1 text-xs text-text-dim">
              Heartbeat{" "}
              <StateValue
                state={telemetry}
                format={(t) => (t.lastHeartbeatAt === null ? <>{NOT_AVAILABLE}</> : <TimeValue at={t.lastHeartbeatAt} />)}
                fallback="Telemetry unavailable"
              />
            </p>
          </div>
          <AwaitingSource>Vault reads and telemetry heartbeat, once your vault is deployed</AwaitingSource>
        </aside>
      </div>

      <section className="panel mt-8 p-5">
        <h2 className="font-display text-2xl uppercase text-newsprint">Recent fills</h2>
        <p className="mt-1 text-sm text-text-dim">
          Intents your vault won and funded. Each one advanced capital to a recipient before canonical
          settlement returned it.
        </p>
        <FillsTable state={fills} />

      </section>
    </div>
  );
}

function Step({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-2xl uppercase text-newsprint">{title}</h2>
      <p className="measure mt-1 text-sm text-text-dim">{hint}</p>
      {children}
    </div>
  );
}

function Row({ k, v, tone = "text-text" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-text-dim">{k}</dt>
      <dd className={`num text-right ${tone}`}>{v}</dd>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className="text-[11px] uppercase tracking-wide text-text-dim">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
