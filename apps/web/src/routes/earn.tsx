import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { decodeEventLog, encodeEventTopics, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { InvalidFeePolicyError, feeBpsAt, validateFeePolicy, type FeePolicy } from "@arcaidia/domain";
import { erc20Abi, solverVaultAbi, vaultFactoryAbi } from "@/lib/arcaidia/abis";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";
import { viemChainFor } from "@/lib/arcaidia/viem-chains";
import { toast } from "sonner";
import { CopyValue } from "@/components/site/copy-value";
import { TimeValue } from "@/components/site/time-value";
import { ARC_TESTNET, CHAINS, ETHEREUM_SEPOLIA, type Address, type Hex } from "@/lib/arcaidia/types";
import { formatBps, formatUsdc, isAddressLike, parseUsdc, truncateAddress } from "@/lib/arcaidia/format";
import { ChainBadge, FillsTable, UtilisationMeter } from "@/components/vaults/vault-bits";
import { useWallet } from "@/components/wallet/wallet-context";
import { chainConfig, SERVICES, SUPPORTED_CHAIN_IDS } from "@/lib/arcaidia/config";
import { NOT_AVAILABLE, type DataState } from "@/lib/arcaidia/data-state";
import { AwaitingSource, StateValue } from "@/components/data/state-views";
import { useSolverMetrics, type SolverMetrics } from "@/hooks/arcaidia/use-solver-metrics";
import { useSolverTelemetry, type SolverTelemetry } from "@/hooks/arcaidia/use-solver-telemetry";
import { useOwnedVaults, type OwnedVaultRow } from "@/hooks/arcaidia/use-owned-vaults";
import { useVaultFills } from "@/hooks/arcaidia/use-vault-fills";
import type { FillRow } from "@/lib/arcaidia/types";

export const Route = createFileRoute("/earn")({
  head: () => ({
    meta: [
      { title: "Earn — deploy a solver vault | Arcaidia" },
      {
        name: "description",
        content:
          "Deploy your own Arcaidia solver vault on one chain or both: fund it with USDC, set its economics, connect a solver and go live competing for the first valid fill.",
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
  { n: 1, label: "Choose chains" },
  { n: 2, label: "Create vault" },
  { n: 3, label: "Fund vault" },
  { n: 4, label: "Set up solver" },
  { n: 5, label: "Go live" },
] as const;

/** The one-command run for a solver whose whole config is the downloaded env file. */
const RUN_COMMAND = `git clone https://github.com/immaxkent/arcaidia.git && cd arcaidia
cp ~/Downloads/arcaidia-solver.env .env
docker compose up --build -d && docker compose logs -f arcaidia-solver`;

/** Matches `CHAIN_ENV_PREFIX` in packages/agent/src/entrypoint/config.ts exactly. */
const CHAIN_ENV_PREFIX: Record<number, string> = {
  [ETHEREUM_SEPOLIA]: "ETHEREUM_SEPOLIA",
  [ARC_TESTNET]: "ARC_TESTNET",
};

/** A vault the solver serves — one line of config per chain it lives on. */
export interface VaultTarget {
  readonly chainId: number;
  readonly vaultAddress: Address;
}

/**
 * WP-19.1 — the non-secret runtime config block for the vault(s) this wallet
 * just deployed, in the shape `.env.example` and the reference Docker
 * Compose stack (WP-17.3) actually read, not an idealised placeholder. One
 * solver process serves every chain listed here — a vault deployed on both
 * chains is two lines in one file, not two solvers.
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
export function runtimeConfigText(vaults: readonly VaultTarget[], telemetryUrl: string | null): string {
  const perChain = vaults
    .map((v) => {
      const prefix = CHAIN_ENV_PREFIX[v.chainId] ?? "UNKNOWN_CHAIN";
      return `${prefix}_LIQUIDITY_VAULT=${v.vaultAddress}

# Unset ${prefix}_RPC_URL to use the public default RPC endpoint. Set it only
# if you want your own (a private/paid RPC, or your own node).
# ${prefix}_RPC_URL=

# Unset means "use Arcaidia's own shared, unlimited indexer" — no Graph
# account or API key needed. Set only to point this solver at your own
# subgraph or indexer instead.
# SUBGRAPH_URL_${prefix}=
`;
    })
    .join("\n");
  return `# Arcaidia solver runtime config — generated for your vault.
# Set these in the reference solver's .env (see .env.example), or as
# container env vars for any other deployment target.
#
# LOCAL_AGENT_PRIVATE_KEY / LOCAL_SUBMITTER_PRIVATE_KEY are yours to add in
# the same .env — the signer produces fill authorisations, the submitter pays
# gas to broadcast them (see .env.example). This page never sees or emits them.
#
# One solver serves every chain below.

${perChain}
TELEMETRY_ENABLED=true
ARCAIDIA_TELEMETRY_URL=${telemetryUrl ?? "# not configured for this deployment yet"}
`;
}

/**
 * The complete solver env for download — `runtimeConfigText`'s non-secret block plus the two
 * keys the browser just generated for this operator. Produced client-side only, handed to the
 * user as a file, never sent anywhere: Arcaidia and the Privy wallet never see these keys.
 */
export function solverEnvText(
  vaults: readonly VaultTarget[],
  keys: { signerKey: `0x${string}`; submitterKey: `0x${string}` },
  telemetryUrl: string | null,
): string {
  return `${runtimeConfigText(vaults, telemetryUrl)}
# --- Your solver's own identity — generated in your browser on /earn, kept only by you ---
LOCAL_AGENT_PRIVATE_KEY=${keys.signerKey}
LOCAL_SUBMITTER_PRIVATE_KEY=${keys.submitterKey}
`;
}

/** Everything one chain's side of the flow has actually done — each field set by a receipt. */
interface ChainProgress {
  /** Set only from a confirmed factory deployment receipt (`VaultCreated`). */
  vaultAddress: Address | null;
  deploying: boolean;
  deployError: string | null;
  funding: string;
  depositing: boolean;
  depositError: string | null;
  depositedTotal: bigint;
  gasSending: boolean;
  gasTxHash: Hex | null;
  gasError: string | null;
  authorising: boolean;
  authoriseError: string | null;
  pausing: boolean;
  pauseError: string | null;
}

const EMPTY_PROGRESS: ChainProgress = {
  vaultAddress: null,
  deploying: false,
  deployError: null,
  funding: "",
  depositing: false,
  depositError: null,
  depositedTotal: 0n,
  gasSending: false,
  gasTxHash: null,
  gasError: null,
  authorising: false,
  authoriseError: null,
  pausing: false,
  pauseError: null,
};

const CHAIN_CHOICES = [
  { id: "both", label: "Both chains", detail: "One vault, one address, one solver — recommended", chains: [ETHEREUM_SEPOLIA, ARC_TESTNET] },
  { id: "ethereum", label: "Ethereum only", detail: CHAINS[ETHEREUM_SEPOLIA]?.name ?? "Ethereum Sepolia", chains: [ETHEREUM_SEPOLIA] },
  { id: "arc", label: "Arc only", detail: CHAINS[ARC_TESTNET]?.name ?? "Arc Testnet", chains: [ARC_TESTNET] },
] as const;

function sameChains(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** Gas for the submitter, from the connected wallet: 0.02 ETH on Ethereum, 2 USDC (the gas token) on Arc. */
function gasTopUpFor(chainId: number): { value: bigint; label: string } {
  return chainId === ARC_TESTNET ? { value: parseEther("2"), label: "2 USDC" } : { value: parseEther("0.02"), label: "0.02 ETH" };
}

/**
 * The live facts for one chain's side of the vault, all from real sources: telemetry from the
 * relay, authorisation/liquidity from contract reads, fills from the indexer or the chain.
 */
interface ChainStatus {
  readonly chainId: number;
  readonly telemetry: DataState<SolverTelemetry>;
  readonly metrics: DataState<SolverMetrics>;
  readonly fills: DataState<FillRow[]>;
  readonly authorised: boolean;
  readonly live: boolean;
}

function useChainStatus(chainId: number, vaultAddress: Address | null, typedOperator: Address | null): ChainStatus {
  // Telemetry first: its reported operator/online state feeds useSolverMetrics
  // below (WP-19.4's own rule — telemetry only ever supplies a *candidate*
  // operator to check onchain, never the authorisation fact itself). The
  // owner's own typed/generated address takes priority once it's a well-formed
  // address — it's what they're about to authorise.
  const telemetry = useSolverTelemetry(chainId, vaultAddress);
  const candidateOperator = typedOperator ?? (telemetry.status === "ready" ? telemetry.data.operatorAddress : null);
  const metrics = useSolverMetrics(chainId, vaultAddress, {
    candidateOperator,
    telemetryOnline: telemetry.status === "ready" ? telemetry.data.online : null,
  });
  const fills = useVaultFills(chainId, vaultAddress);
  return {
    chainId,
    telemetry,
    metrics,
    fills,
    authorised: metrics.status === "ready" && metrics.data.authState === "AUTHORISED",
    live: metrics.status === "ready" && metrics.data.runtimeStatus === "ONLINE",
  };
}

/**
 * The flow's state lives in `EarnFlow`; "Deploy another vault" on the last step remounts it,
 * which is the one honest reset — every step's fact (deployed, funded, authorised) is a real
 * receipt or contract read, so nothing can be carried over to a new vault.
 */
function EarnPage() {
  const [flowKey, setFlowKey] = useState(0);
  return <EarnFlow key={flowKey} onRestart={() => setFlowKey((k) => k + 1)} />;
}

/**
 * HANDOFF — Earn / operator flow.
 *
 * One pass deploys a vault on one chain or both. The factory lives at the same address on
 * every chain and places a vault at `predictVault(creator, salt)`, so the same salt lands the
 * vault at the same address on both chains — "one vault, two chains", which is exactly how
 * one solver process already treats its config (one `_LIQUIDITY_VAULT` line per chain).
 *
 * Every step state comes from a real action, never assumed:
 *   wallet connected      -> useWallet (Privy)
 *   vault deployed        -> factory tx receipt per chain; `vaultAddress` stays null until then
 *   funding confirmed     -> USDC deposit receipt per chain
 *   solver operator known -> generated here / pasted by the owner / reported by telemetry pairing
 *   authorised onchain    -> useSolverMetrics().authState per chain (contract read)
 *   solver live           -> telemetry heartbeat per chain, which is NOT authorisation
 */
function EarnFlow({ onRestart }: { onRestart: () => void }) {
  const wallet = useWallet();
  const { status: walletStatus, address, connect } = wallet;
  const connected = walletStatus === "CONNECTED";

  const [step, setStep] = useState(1);
  const [targets, setTargets] = useState<readonly number[]>([ETHEREUM_SEPOLIA, ARC_TESTNET]);
  const [vaultName, setVaultName] = useState("");
  // One salt for the whole flow: the same salt on every chain is what makes the vault land at
  // one address everywhere (CREATE2 through the identical factory). 32 random bytes.
  const [salt] = useState<Hex>(() => generatePrivateKey());
  // Fees are a per-vault policy (D7); what the owner also controls is risk exposure:
  // maxFillBps caps any one fill as a percentage of the vault's own available
  // liquidity; maxExposureBps caps how much of the vault can be in flight at
  // once. Defaults match the vault contract's own committed defaults' intent
  // (conservative but real capacity), not an arbitrary UI default.
  const [maxFillBps, setMaxFillBps] = useState(5_000);
  const [maxExposureBps, setMaxExposureBps] = useState(9_000);
  const [solverOperator, setSolverOperator] = useState("");
  const [operatorMode, setOperatorMode] = useState<"GENERATE" | "EXTERNAL">("GENERATE");
  /** "I already run a solver": the submitter address it printed, so it can be given gas here too. */
  const [externalSubmitter, setExternalSubmitter] = useState("");
  /** Generated in the browser, held in memory only — never persisted, never sent anywhere. */
  const [identity, setIdentity] = useState<{
    signerKey: `0x${string}`;
    signerAddress: Address;
    submitterKey: `0x${string}`;
    submitterAddress: Address;
  } | null>(null);

  const [progress, setProgress] = useState<Record<number, ChainProgress>>({
    [ETHEREUM_SEPOLIA]: EMPTY_PROGRESS,
    [ARC_TESTNET]: EMPTY_PROGRESS,
  });
  const progressOf = (chainId: number): ChainProgress => progress[chainId] ?? EMPTY_PROGRESS;
  const patch = (chainId: number, next: Partial<ChainProgress>) =>
    setProgress((p) => ({ ...p, [chainId]: { ...(p[chainId] ?? EMPTY_PROGRESS), ...next } }));

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

  function generateIdentity() {
    const signerKey = generatePrivateKey();
    const submitterKey = generatePrivateKey();
    const next = {
      signerKey,
      signerAddress: privateKeyToAccount(signerKey).address as Address,
      submitterKey,
      submitterAddress: privateKeyToAccount(submitterKey).address as Address,
    };
    setIdentity(next);
    setSolverOperator(next.signerAddress);
    for (const id of SUPPORTED_CHAIN_IDS) patch(id, { gasTxHash: null });
  }

  // ---- derived -------------------------------------------------------------------------------
  const vaultNameValid = vaultName.trim().length > 0;
  const deployedTargets: VaultTarget[] = targets.flatMap((id) => {
    const v = progressOf(id).vaultAddress;
    return v ? [{ chainId: id, vaultAddress: v }] : [];
  });
  const allDeployed = targets.length > 0 && deployedTargets.length === targets.length;
  const anyDeployed = deployedTargets.length > 0;
  /** With one salt through one factory, both sides land at one address — shown as such once true. */
  const sharedAddress =
    deployedTargets.length > 1 && deployedTargets.every((t) => t.vaultAddress.toLowerCase() === deployedTargets[0]!.vaultAddress.toLowerCase())
      ? deployedTargets[0]!.vaultAddress
      : null;
  const operatorValid = isAddressLike(solverOperator.trim());
  const typedOperator = operatorValid ? (solverOperator.trim() as Address) : null;
  const submitterAddress: Address | null =
    operatorMode === "GENERATE"
      ? (identity?.submitterAddress ?? null)
      : isAddressLike(externalSubmitter.trim())
        ? (externalSubmitter.trim() as Address)
        : null;
  // A step is reachable by clicking its own tab only once every step before
  // it is satisfied — Back is always free, but skipping ahead of the
  // furthest-completed step is not, so a vault's name/economics are always
  // captured before anything downstream (fund, authorise) can read them.
  const maxReachableStep = vaultNameValid ? 5 : 2;

  // Two explicit hook calls (rules of hooks): every supported chain gets its status hooks
  // whether or not it is a target — a non-target simply has no vault and reads as unavailable.
  const sepolia = useChainStatus(ETHEREUM_SEPOLIA, progressOf(ETHEREUM_SEPOLIA).vaultAddress, typedOperator);
  const arc = useChainStatus(ARC_TESTNET, progressOf(ARC_TESTNET).vaultAddress, typedOperator);
  const statusOf = (chainId: number): ChainStatus => (chainId === ARC_TESTNET ? arc : sepolia);
  const owned = useOwnedVaults(connected ? (address as Address) : null);
  /** Owned vaults grouped by address: a vault deployed on both chains is one entry, two chains. */
  const ownedGroups = useMemo(() => {
    if (owned.status !== "ready") return [];
    const groups = new Map<string, { address: Address; label: string | null; chains: OwnedVaultRow[] }>();
    for (const row of owned.data) {
      const key = row.vaultAddress.toLowerCase();
      const g = groups.get(key) ?? { address: row.vaultAddress, label: row.label, chains: [] };
      g.chains.push(row);
      if (!g.label && row.label) g.label = row.label;
      groups.set(key, g);
    }
    return [...groups.values()];
  }, [owned]);

  // ---- chain actions -------------------------------------------------------------------------
  /** Puts the wallet on `chainId`, then runs one owner-signed action there. */
  async function onChain<T>(
    chainId: number,
    run: (clients: { walletClient: Awaited<ReturnType<typeof wallet.getWalletClient>>; publicClient: NonNullable<ReturnType<typeof publicClientFor>> }) => Promise<T>,
  ): Promise<T> {
    if (!connected || !address) throw new Error("Connect a wallet first.");
    const publicClient = publicClientFor(chainId);
    if (!publicClient) throw new Error(`RPC is not configured for ${CHAINS[chainId]?.short ?? chainId} yet.`);
    await wallet.switchChain(chainId);
    const walletClient = await wallet.getWalletClient(chainId);
    return run({ walletClient, publicClient });
  }
  const message = (error: unknown) => (error instanceof Error ? error.message : "Transaction failed.");

  /** The real thing: `ArcaidiaVaultFactory.createVault(...)` on one chain, owner-signed through Privy. */
  async function deployOn(chainId: number) {
    const factory = chainConfig(chainId)?.vaultFactory ?? null;
    if (!factory || !address) return;
    patch(chainId, { deploying: true, deployError: null });
    try {
      const vault = await onChain(chainId, async ({ walletClient, publicClient }) => {
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
        const log = receipt.logs.find((l) => l.address.toLowerCase() === factory.toLowerCase() && l.topics[0] === topic);
        if (!log) throw new Error("Transaction confirmed but no VaultCreated event was found.");
        const decoded = decodeEventLog({ abi: vaultFactoryAbi, data: log.data, topics: log.topics, eventName: "VaultCreated" });
        return decoded.args.vault as Address;
      });
      patch(chainId, { vaultAddress: vault });
      toast.success(`Vault created on ${CHAINS[chainId]?.short}`, { description: vault });
    } catch (error) {
      patch(chainId, { deployError: message(error) });
    } finally {
      patch(chainId, { deploying: false });
    }
  }

  /** Every target that is not deployed yet, in order — the wallet switches network between them. */
  async function deployAll() {
    for (const id of targets) if (!progressOf(id).vaultAddress) await deployOn(id);
  }

  /** ERC-4626 `deposit` into the operator's own vault on one chain: approve USDC, then deposit. */
  async function depositOn(chainId: number) {
    const config = chainConfig(chainId);
    const vaultAddress = progressOf(chainId).vaultAddress;
    const amount = parseUsdc(progressOf(chainId).funding);
    if (!vaultAddress || !address) return;
    if (!config?.usdc) return patch(chainId, { depositError: "USDC not configured for this chain yet." });
    if (!amount || amount <= 0n) return patch(chainId, { depositError: "Enter an amount." });
    const usdc = config.usdc;
    patch(chainId, { depositing: true, depositError: null });
    try {
      await onChain(chainId, async ({ walletClient, publicClient }) => {
        const chain = viemChainFor(chainId);
        const allowance = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [address, vaultAddress] });
        if (allowance < amount) {
          const approveHash = await walletClient.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [vaultAddress, amount], chain, account: address });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        const hash = await walletClient.writeContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "deposit", args: [amount, address], chain, account: address });
        await publicClient.waitForTransactionReceipt({ hash });
      });
      patch(chainId, { depositedTotal: progressOf(chainId).depositedTotal + amount });
      toast.success("Deposited", { description: `${formatUsdc(amount)} USDC into ${truncateAddress(vaultAddress)} on ${CHAINS[chainId]?.short}` });
    } catch (error) {
      patch(chainId, { depositError: message(error) });
    } finally {
      patch(chainId, { depositing: false });
    }
  }

  async function sendGasOn(chainId: number) {
    if (!submitterAddress || !address) return;
    patch(chainId, { gasSending: true, gasError: null });
    try {
      const hash = await onChain(chainId, async ({ walletClient, publicClient }) => {
        const hash = await walletClient.sendTransaction({ to: submitterAddress, value: gasTopUpFor(chainId).value, chain: viemChainFor(chainId), account: address });
        await publicClient.waitForTransactionReceipt({ hash });
        return hash;
      });
      patch(chainId, { gasTxHash: hash });
      toast.success(`Gas sent on ${CHAINS[chainId]?.short}`, { description: truncateAddress(submitterAddress) });
    } catch (error) {
      patch(chainId, { gasError: message(error) });
    } finally {
      patch(chainId, { gasSending: false });
    }
  }

  /** `setAuthorisedSigner(operator, true)` — the owner's own call on their own vault, per chain. */
  async function authoriseOn(chainId: number) {
    const vaultAddress = progressOf(chainId).vaultAddress;
    if (!vaultAddress || !typedOperator || !address) return;
    patch(chainId, { authorising: true, authoriseError: null });
    try {
      await onChain(chainId, async ({ walletClient, publicClient }) => {
        const hash = await walletClient.writeContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "setAuthorisedSigner", args: [typedOperator, true], chain: viemChainFor(chainId), account: address });
        await publicClient.waitForTransactionReceipt({ hash });
      });
      toast.success(`Solver authorised on ${CHAINS[chainId]?.short}`, { description: truncateAddress(typedOperator) });
    } catch (error) {
      patch(chainId, { authoriseError: message(error) });
    } finally {
      patch(chainId, { authorising: false });
    }
  }

  async function setPausedOn(chainId: number, paused: boolean) {
    const vaultAddress = progressOf(chainId).vaultAddress;
    if (!vaultAddress || !address) return;
    patch(chainId, { pausing: true, pauseError: null });
    try {
      await onChain(chainId, async ({ walletClient, publicClient }) => {
        const hash = await walletClient.writeContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "setPaused", args: [paused], chain: viemChainFor(chainId), account: address });
        await publicClient.waitForTransactionReceipt({ hash });
      });
      toast.success(paused ? `Vault paused on ${CHAINS[chainId]?.short}` : `Vault resumed on ${CHAINS[chainId]?.short}`);
    } catch (error) {
      patch(chainId, { pauseError: message(error) });
    } finally {
      patch(chainId, { pausing: false });
    }
  }

  function downloadSolverEnv() {
    if (!identity || deployedTargets.length === 0) return;
    const text = solverEnvText(deployedTargets, identity, SERVICES.solverTelemetryUrl);
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "arcaidia-solver.env";
    a.click();
    URL.revokeObjectURL(url);
  }

  function resumeGroup(group: { address: Address; label: string | null; chains: OwnedVaultRow[] }) {
    const chains = SUPPORTED_CHAIN_IDS.filter((id) => group.chains.some((c) => c.chainId === id));
    setTargets(chains);
    for (const row of group.chains) patch(row.chainId, { vaultAddress: row.vaultAddress });
    setVaultName(group.label ?? truncateAddress(group.address));
    setStep(3);
  }

  const chainList = targets.map((id) => CHAINS[id]?.short ?? String(id)).join(" and ");
  const chainClassName = (active: boolean) => `instrument p-4 text-left transition-colors ${active ? "border-acid/60" : ""}`;
  const primaryButton = "w-full rounded-lg border border-acid/60 bg-acid/15 py-3 text-sm font-semibold uppercase tracking-wide text-acid disabled:opacity-50";
  const smallButton = "rounded-lg border border-acid/60 bg-acid/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-acid disabled:opacity-50";

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

      {/* Resume: the factory knows which vaults this wallet owns, so a reload never strands anyone. */}
      {connected && !anyDeployed && ownedGroups.length > 0 ? (
        <section className="panel mt-6 p-4">
          <p className="text-[11px] uppercase tracking-wide text-text-dim">Your vaults</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {ownedGroups.map((g) => (
              <li key={g.address}>
                <button type="button" onClick={() => resumeGroup(g)} className="instrument w-full p-3 text-left">
                  <span className="block text-sm font-semibold text-text">{g.label ?? truncateAddress(g.address)}</span>
                  <span className="num mt-1 block text-[11px] text-text-dim">
                    {truncateAddress(g.address)} · {g.chains.map((c) => CHAINS[c.chainId]?.short).join(" + ")}
                  </span>
                  {g.chains.map((c) => (
                    <span key={c.chainId} className="num mt-1 block text-[11px] text-text-dim">
                      {CHAINS[c.chainId]?.short}: {c.availableLiquidity !== null ? `${formatUsdc(c.availableLiquidity)} USDC available` : "—"} · fee{" "}
                      {c.currentFeeBps !== null ? formatBps(c.currentFeeBps) : "—"}
                    </span>
                  ))}
                  <span className="num mt-1 block text-[10px] uppercase tracking-wide text-acid">Continue with this vault →</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ol className="mt-8 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {STEPS.map((s) => {
          const state = s.n === step ? "current" : s.n < step ? "done" : "todo";
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
            <Step
              title="Choose chains"
              hint="Your vault advances liquidity on the chains you pick. Deployed on both, it is one vault at one address, served by one solver."
            >
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {CHAIN_CHOICES.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    disabled={anyDeployed}
                    onClick={() => setTargets(choice.chains)}
                    aria-pressed={sameChains(choice.chains, targets)}
                    className={`${chainClassName(sameChains(choice.chains, targets))} disabled:opacity-60`}
                  >
                    <span className="font-display text-2xl uppercase text-newsprint">{choice.label}</span>
                    <span className="num mt-1 block text-[11px] text-text-dim">{choice.detail}</span>
                  </button>
                ))}
              </div>
              {anyDeployed ? (
                <p className="num mt-3 text-[11px] text-text-dim">Fixed once a vault is deployed — use "Deploy another vault" on the last step for a different choice.</p>
              ) : null}
            </Step>
          ) : null}

          {step === 2 ? (
            <Step
              title="Create vault"
              hint="Configure your vault once, then deploy it from the supported factory template — one transaction per chain, with the wallet switching network between them. No custom vault code; economics below are set at deploy time, not editable after."
            >
              <Field label="Vault name" id="vault-name">
                <input
                  id="vault-name"
                  placeholder="e.g. Midnight Runner"
                  value={vaultName}
                  onChange={(e) => setVaultName(e.target.value)}
                  disabled={anyDeployed}
                  className="num w-full rounded-md border border-border bg-void px-3 py-2 text-sm text-text disabled:opacity-60"
                />
              </Field>
              <p className="num mt-1 text-[11px] text-text-dim">
                Shown on the console and the liquidity directory — carried in the deployment event.
              </p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row k="Template" v="ArcaidiaSolverVault (standard)" />
                <Row k="Chains" v={chainList} />
                <Row k="Asset" v="USDC" />
                <Row k="Owner" v={connected && address ? truncateAddress(address) : "Connect wallet"} tone={connected ? "text-text" : "text-warning"} />
              </dl>

              {/* Risk exposure — the two caps, part of the same createVault transaction as the
                  fee policy below. Unlike the policy, the owner may adjust these later. */}
              <div className="mt-5 space-y-4 border-t border-border/60 pt-4">
                <p className="text-[11px] uppercase tracking-wide text-text-dim">Risk exposure</p>
                <Field label={`Max single fill — ${formatBps(maxFillBps)} of available liquidity`} id="max-fill-bps">
                  <input id="max-fill-bps" type="range" min={500} max={10_000} step={100} value={maxFillBps} disabled={anyDeployed} onChange={(e) => setMaxFillBps(Number(e.target.value))} className="w-full accent-acid" />
                </Field>
                <p className="num text-[11px] text-text-dim">The largest share of your vault's *remaining* available liquidity any one fill may take.</p>
                <Field label={`Max utilisation — ${formatBps(maxExposureBps)}`} id="max-exposure-bps">
                  <input id="max-exposure-bps" type="range" min={1_000} max={9_800} step={100} value={maxExposureBps} disabled={anyDeployed} onChange={(e) => setMaxExposureBps(Number(e.target.value))} className="w-full accent-acid" />
                </Field>
                <p className="num text-[11px] text-text-dim">The most of your vault's capital that may be in flight (advanced, awaiting canonical settlement) at once.</p>
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
                        disabled={anyDeployed}
                        onChange={(e) => setPolicy((p) => ({ ...p, [key]: Number(e.target.value) || 0 }))}
                        className="num w-full rounded-md border border-border bg-void px-3 py-2 text-sm text-text disabled:opacity-60"
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
                        disabled={anyDeployed}
                        onChange={(e) => setPolicy((p) => ({ ...p, [key]: Number(e.target.value) || 0 }))}
                        className="num w-full rounded-md border border-border bg-void px-3 py-2 text-sm text-text disabled:opacity-60"
                      />
                    </Field>
                  ))}
                </div>
                {policyError ? (
                  <p className="num text-[11px] text-warning">{policyError}</p>
                ) : (
                  <p className="num text-[11px] text-text-dim" data-testid="policy-preview">
                    Preview: {[0, 2_500, 5_000, 7_500, 9_000, 10_000].map((u) => `${formatBps(u)} → ${formatBps(feeBpsAt(policy, u))}`).join(" · ")}
                  </p>
                )}
              </div>

              <dl className="mt-4 space-y-1.5 text-sm">
                <Row k="Reserve floor" v={formatBps(RESERVE_FLOOR_BPS)} />
              </dl>

              <button
                type="button"
                disabled={!connected || !vaultNameValid || policyError !== null || allDeployed || targets.some((id) => progressOf(id).deploying) || targets.some((id) => !chainConfig(id)?.vaultFactory)}
                onClick={() => (connected ? void deployAll() : connect())}
                className={`mt-4 ${primaryButton}`}
              >
                {allDeployed
                  ? "Vault deployed"
                  : targets.some((id) => progressOf(id).deploying)
                    ? "Deploying…"
                    : `Deploy on ${chainList}`}
              </button>
              {!connected ? (
                <button type="button" onClick={() => connect()} className="num mt-2 text-[11px] uppercase tracking-wide text-electric-glow hover:text-acid">
                  Connect wallet first
                </button>
              ) : null}

              {/* Per-chain outcome, each row a real receipt or a real error with its own retry. */}
              <ul className="mt-4 space-y-2">
                {targets.map((id) => {
                  const p = progressOf(id);
                  return (
                    <li key={id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 px-3 py-2">
                      <ChainBadge chainId={id} />
                      {p.vaultAddress ? (
                        <span className="num text-xs text-text">
                          Deployed · <CopyValue value={p.vaultAddress} label="vault address" />
                        </span>
                      ) : p.deploying ? (
                        <span className="num text-xs text-text-dim">Confirm in your wallet…</span>
                      ) : p.deployError ? (
                        <span className="text-xs text-warning">{p.deployError}</span>
                      ) : (
                        <span className="num text-xs text-text-dim">Not deployed yet</span>
                      )}
                      {!p.vaultAddress && p.deployError ? (
                        <button type="button" onClick={() => void deployOn(id)} className={`ml-auto ${smallButton}`}>
                          Retry
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {sharedAddress ? (
                <p className="num mt-2 text-[11px] text-acid">One address on both chains: {truncateAddress(sharedAddress)}</p>
              ) : null}
              {targets.some((id) => !chainConfig(id)?.vaultFactory) ? (
                <AwaitingSource>Vault factory not deployed on every selected chain yet</AwaitingSource>
              ) : null}
            </Step>
          ) : null}

          {step === 3 ? (
            <Step title="Fund vault" hint="Deposit USDC on each chain your vault lives on. Capital is per chain — it does not move between them. A reserve floor stays behind so the vault can always unwind.">
              <div className="mt-3 space-y-4">
                {targets.map((id) => {
                  const p = progressOf(id);
                  const funded = parseUsdc(p.funding) ?? 0n;
                  const reserveFloor = funded / 10n;
                  const usable = funded - reserveFloor;
                  return (
                    <div key={id} className="panel-raised px-3 py-3">
                      <div className="flex items-center justify-between">
                        <ChainBadge chainId={id} />
                        {p.vaultAddress ? (
                          <span className="num text-[11px] text-text-dim">{truncateAddress(p.vaultAddress)}</span>
                        ) : (
                          <span className="num text-[11px] text-warning">Deploy on step 2 first</span>
                        )}
                      </div>
                      <label htmlFor={`fund-amount-${id}`} className="mt-3 block text-[11px] uppercase tracking-wide text-text-dim">
                        Deposit amount on {CHAINS[id]?.short}
                      </label>
                      <div className="mt-1 flex items-baseline gap-2">
                        <input
                          id={`fund-amount-${id}`}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={p.funding}
                          onChange={(e) => patch(id, { funding: e.target.value })}
                          className="num w-full bg-transparent text-2xl text-text outline-none placeholder:text-text-dim/50"
                        />
                        <span className="num text-sm text-text-dim">USDC</span>
                      </div>
                      <dl className="mt-3 space-y-1.5 text-sm">
                        <Row k="Reserve floor (10%)" v={`${formatUsdc(reserveFloor)} USDC`} />
                        <Row k="Usable fill capital" v={`${formatUsdc(usable)} USDC`} tone="text-acid" />
                      </dl>
                      <button
                        type="button"
                        disabled={!connected || !p.vaultAddress || p.depositing || !parseUsdc(p.funding)}
                        onClick={() => void depositOn(id)}
                        className={`mt-3 ${primaryButton}`}
                      >
                        {p.depositing ? "Depositing…" : `Deposit USDC on ${CHAINS[id]?.short}`}
                      </button>
                      {p.depositError ? <p className="mt-2 text-xs text-warning">{p.depositError}</p> : null}
                      {p.depositedTotal > 0n ? (
                        <p className="num mt-2 text-[11px] text-acid">Deposited this session: {formatUsdc(p.depositedTotal)} USDC</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Step>
          ) : null}

          {step === 4 ? (
            <Step
              title="Set up solver"
              hint="Your solver is a small program you run — Arcaidia never holds its key. One solver serves every chain your vault is on. This step creates its identity, gives it gas on each chain, authorises it on each vault, and hands you the one command to start it."
            >
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    { id: "GENERATE" as const, t: "Create a solver here", d: "Identity generated in your browser; download one file; run one command." },
                    { id: "EXTERNAL" as const, t: "I already run a solver", d: "Paste the two addresses it prints on start." },
                  ]
                ).map((o) => (
                  <button key={o.id} type="button" onClick={() => setOperatorMode(o.id)} aria-pressed={operatorMode === o.id} className={chainClassName(operatorMode === o.id)}>
                    <span className="block text-sm font-semibold text-text">{o.t}</span>
                    <span className="mt-1 block text-xs text-text-dim">{o.d}</span>
                  </button>
                ))}
              </div>

              {operatorMode === "GENERATE" ? (
                <div className="mt-5 space-y-4">
                  {/* 1 — identity */}
                  <div className="panel-raised px-3 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] uppercase tracking-wide text-text-dim">1 · Solver identity</p>
                      <button type="button" onClick={generateIdentity} className="num rounded border border-acid/50 px-2 py-1 text-[11px] uppercase tracking-wide text-acid hover:bg-acid/10">
                        {identity ? "Regenerate" : "Generate"}
                      </button>
                    </div>
                    {identity ? (
                      <dl className="mt-2 space-y-1 text-sm">
                        <Row k="Signer (authorised on your vault)" v={truncateAddress(identity.signerAddress)} tone="text-acid" />
                        <Row k="Submitter (pays gas for fills)" v={truncateAddress(identity.submitterAddress)} />
                      </dl>
                    ) : (
                      <p className="mt-2 text-xs text-text-dim">Two keys are made in this browser tab and never leave it. You keep them in the file below.</p>
                    )}
                    {identity ? (
                      <p className="num mt-2 text-[11px] text-warning">Download the file before leaving this page — the keys exist only here until you do.</p>
                    ) : null}
                  </div>

                  {/* 2 — the file */}
                  <div className="panel-raised px-3 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-text-dim">2 · Config file</p>
                    <button type="button" disabled={!identity || !allDeployed} onClick={downloadSolverEnv} className="mt-2 w-full rounded-lg border border-electric/60 bg-electric/10 py-2.5 text-xs font-semibold uppercase tracking-wide text-electric-glow disabled:opacity-50">
                      Download arcaidia-solver.env
                    </button>
                    <p className="mt-2 text-xs text-text-dim">
                      Everything the solver needs: your vault on {chainList}, the indexer, telemetry, and the two keys.
                      {!allDeployed ? " (Deploy on every chain on step 2 first.)" : ""}
                    </p>
                  </div>

                  {/* 3 — gas, per chain */}
                  <div className="panel-raised px-3 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-text-dim">3 · Gas for the submitter</p>
                    <p className="mt-2 text-xs text-text-dim">Fills are transactions your submitter broadcasts on each chain; each top-up covers a few hundred of them.</p>
                    <GasRows targets={targets} progressOf={progressOf} enabled={connected && Boolean(identity)} onSend={sendGasOn} />
                  </div>

                  {/* 4 — authorise, per chain */}
                  <div className="panel-raised px-3 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-text-dim">4 · Authorise on your vault</p>
                    <p className="mt-2 text-xs text-text-dim">Writes the signer to your vault on chain. Only authorised signers can ever move your vault's capital, and you can revoke at any time.</p>
                    <AuthoriseRows targets={targets} progressOf={progressOf} statusOf={statusOf} enabled={connected && operatorValid} onAuthorise={authoriseOn} />
                  </div>

                  {/* 5 — run */}
                  <div className="panel-raised px-3 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] uppercase tracking-wide text-text-dim">5 · Run it</p>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(RUN_COMMAND);
                          toast.success("Copied", { description: "Run command" });
                        }}
                        className="text-[10px] font-semibold uppercase tracking-wide text-electric-glow hover:text-electric"
                      >
                        Copy
                      </button>
                    </div>
                    <pre className="num mt-2 overflow-x-auto rounded-md border border-border bg-void px-3 py-3 text-[11px] leading-relaxed text-text-dim">{RUN_COMMAND}</pre>
                    <p className="mt-2 text-xs text-text-dim">
                      Needs Docker. The solver prints <code className="num">[solver] signer {identity ? truncateAddress(identity.signerAddress) : "0x…"}</code> on start and appears on the next step within a minute.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <p className="text-xs text-text-dim">
                    A running solver prints two addresses on start: <code className="num">[solver] signer</code>, which signs its fills and needs your vault's
                    authorisation, and <code className="num">[solver] submitter</code>, which broadcasts them and needs gas. Paste both, then do each chain.
                  </p>
                  <div className="panel-raised px-3 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-text-dim">1 · Addresses</p>
                    <Field label="Signer address" id="solver-operator">
                      <input id="solver-operator" placeholder="0x…" value={solverOperator} onChange={(e) => setSolverOperator(e.target.value)} className="num w-full rounded-md border border-border bg-void px-3 py-2 text-sm text-text" />
                    </Field>
                    <p className="num text-[11px] text-text-dim">
                      {operatorValid ? "Valid address" : solverOperator.trim().length === 0 ? "The address after [solver] signer" : "Not a valid 20-byte address"}
                    </p>
                    <Field label="Submitter address" id="solver-submitter">
                      <input id="solver-submitter" placeholder="0x…" value={externalSubmitter} onChange={(e) => setExternalSubmitter(e.target.value)} className="num w-full rounded-md border border-border bg-void px-3 py-2 text-sm text-text" />
                    </Field>
                    <p className="num text-[11px] text-text-dim">
                      {submitterAddress ? "Valid address" : externalSubmitter.trim().length === 0 ? "The address after [solver] submitter" : "Not a valid 20-byte address"}
                    </p>
                  </div>
                  <div className="panel-raised px-3 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-text-dim">2 · Authorise the signer</p>
                    <AuthoriseRows targets={targets} progressOf={progressOf} statusOf={statusOf} enabled={connected && operatorValid} onAuthorise={authoriseOn} />
                  </div>
                  <div className="panel-raised px-3 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-text-dim">3 · Gas for the submitter</p>
                    <p className="mt-2 text-xs text-text-dim">Already funded it yourself? Skip this.</p>
                    <GasRows targets={targets} progressOf={progressOf} enabled={connected && Boolean(submitterAddress)} onSend={sendGasOn} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] uppercase tracking-wide text-text-dim">Runtime config for your solver</p>
                      {allDeployed ? (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(runtimeConfigText(deployedTargets, SERVICES.solverTelemetryUrl));
                            toast.success("Copied", { description: "Runtime config" });
                          }}
                          className="text-[10px] font-semibold uppercase tracking-wide text-electric-glow hover:text-electric"
                        >
                          Copy
                        </button>
                      ) : null}
                    </div>
                    {allDeployed ? (
                      <pre className="num mt-2 overflow-x-auto rounded-md border border-border bg-void px-3 py-3 text-[11px] leading-relaxed text-text-dim">
                        {runtimeConfigText(deployedTargets, SERVICES.solverTelemetryUrl)}
                      </pre>
                    ) : (
                      <AwaitingSource>Deploy on every chain first — the config names each vault address</AwaitingSource>
                    )}
                  </div>
                </div>
              )}
              <AwaitingSource>Authorisation is read from each vault contract — a running solver is never assumed from it</AwaitingSource>
            </Step>
          ) : null}

          {step === 5 ? (
            <Step title="Go live" hint="Nothing to activate — a vault with capital and an authorised, running solver is live. This watches each fact land, per chain.">
              {allDeployed && targets.every((id) => statusOf(id).authorised) ? (
                <div className="mt-3 rounded-md border border-acid/60 bg-acid/10 px-3 py-3">
                  <p className="text-sm font-semibold uppercase tracking-wide text-acid">Your vault is live on chain</p>
                  <p className="mt-1 text-xs text-text-dim">
                    Everything on-chain is done — this is the last step. Your vault can win fills as soon as your solver process is running (step 4, "Run
                    it"); the rows below turn green as it reports in and lands its first fill. Want another vault? Deploy another vault below.
                  </p>
                </div>
              ) : null}

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-text-dim">
                      <th className="pb-2 font-medium">Fact</th>
                      {targets.map((id) => (
                        <th key={id} className="pb-2 font-medium">
                          {CHAINS[id]?.short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        {
                          label: "Vault deployed",
                          cell: (id: number) => {
                            const v = progressOf(id).vaultAddress;
                            return { done: v !== null, detail: v ? truncateAddress(v) : "step 2" };
                          },
                        },
                        {
                          label: "Capital deposited",
                          cell: (id: number) => {
                            const m = statusOf(id).metrics;
                            const available = m.status === "ready" ? m.data.availableLiquidity : null;
                            return { done: progressOf(id).depositedTotal > 0n || (available ?? 0n) > 0n, detail: available !== null ? `${formatUsdc(available)} USDC available` : "step 3" };
                          },
                        },
                        {
                          label: "Solver authorised on chain",
                          cell: (id: number) => ({ done: statusOf(id).authorised, detail: statusOf(id).authorised ? "read from the vault" : "step 4" }),
                        },
                        {
                          label: "Solver runtime paired",
                          cell: (id: number) => {
                            const t = statusOf(id).telemetry;
                            return { done: t.status === "ready" && t.data.paired, detail: t.status === "ready" ? (t.data.paired ? "identity proven" : "start it — step 4, 'Run it'") : "telemetry relay not connected" };
                          },
                        },
                        {
                          label: "Solver online",
                          cell: (id: number) => {
                            const t = statusOf(id).telemetry;
                            return { done: statusOf(id).live, detail: t.status === "ready" && t.data.lastHeartbeatAt ? `last heartbeat ${new Date(t.data.lastHeartbeatAt * 1000).toLocaleTimeString()}` : "awaiting first heartbeat" };
                          },
                        },
                        {
                          label: "First fill",
                          cell: (id: number) => {
                            const m = statusOf(id).metrics;
                            const count = m.status === "ready" ? (m.data.transactionCount ?? 0) : 0;
                            return { done: count > 0, detail: count > 0 ? `${count} fills` : "waiting for an intent your vault can win" };
                          },
                        },
                      ] as const
                    ).map((fact) => (
                      <tr key={fact.label} className="border-t border-border/60">
                        <td className="py-2 pr-3 text-text">{fact.label}</td>
                        {targets.map((id) => {
                          const { done, detail } = fact.cell(id);
                          return (
                            <td key={id} className="py-2 pr-3">
                              <span className="flex items-center gap-2">
                                <span className={`grid size-5 shrink-0 place-items-center rounded-full border text-[10px] ${done ? "border-acid bg-acid/20 text-acid" : "border-border text-text-dim"}`}>{done ? "✓" : "·"}</span>
                                <span className="num text-[11px] text-text-dim">{detail}</span>
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="mt-4 space-y-1.5 text-sm">
                <Row k="Vault" v={sharedAddress ? `${truncateAddress(sharedAddress)} on ${chainList}` : deployedTargets.map((t) => `${truncateAddress(t.vaultAddress)} · ${CHAINS[t.chainId]?.short}`).join(" / ") || "Not deployed"} />
                {targets.map((id) => {
                  const m = statusOf(id).metrics;
                  return <Row key={id} k={`Posted fee now · ${CHAINS[id]?.short}`} v={m.status === "ready" && m.data.currentFeeBps !== null ? formatBps(m.data.currentFeeBps) : NOT_AVAILABLE} tone="text-acid" />;
                })}
              </dl>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {targets.map((id) => {
                  const p = progressOf(id);
                  const m = statusOf(id).metrics;
                  const paused = m.status === "ready" && m.data.runtimeStatus === "PAUSED";
                  return (
                    <div key={id}>
                      <button
                        type="button"
                        disabled={!connected || !p.vaultAddress || p.pausing}
                        onClick={() => void setPausedOn(id, !paused)}
                        className="w-full rounded-lg border border-border py-3 text-sm font-semibold uppercase tracking-wide text-text-dim hover:text-text disabled:opacity-50"
                      >
                        {p.pausing ? "Signing…" : paused ? `Resume on ${CHAINS[id]?.short}` : `Pause on ${CHAINS[id]?.short}`}
                      </button>
                      {p.pauseError ? <p className="mt-2 text-xs text-warning">{p.pauseError}</p> : null}
                    </div>
                  );
                })}
              </div>
              <p className="measure mt-3 text-xs text-text-dim">The solver key is replaceable at any time — the vault is the durable identity, and its history stays with it.</p>
              <Link to="/console" className="mt-4 inline-block rounded-lg border border-electric/60 bg-electric/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-electric-glow">
                Open solver console
              </Link>
            </Step>
          ) : null}

          <div className="mt-6 flex gap-2">
            <button type="button" onClick={() => setStep((s) => Math.max(1, s - 1))} className="rounded-md border border-border px-3 py-2 text-xs uppercase tracking-wide text-text-dim hover:text-text">
              Back
            </button>
            {step === 5 ? (
              <button type="button" onClick={onRestart} className="rounded-md border border-acid/60 bg-acid/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-acid">
                Deploy another vault
              </button>
            ) : (
              <button
                type="button"
                disabled={step >= maxReachableStep}
                onClick={() => setStep((s) => Math.min(maxReachableStep, s + 1))}
                className="rounded-md border border-acid/60 bg-acid/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-acid disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next step
              </button>
            )}
            {step === 2 && !vaultNameValid ? <p className="num self-center text-[11px] text-warning">Name your vault to continue</p> : null}
          </div>
        </section>

        <aside className="space-y-6">
          {targets.map((id) => (
            <VaultHealth key={id} status={statusOf(id)} />
          ))}
        </aside>
      </div>

      <section className="panel mt-8 p-5">
        <h2 className="font-display text-2xl uppercase text-newsprint">Recent fills</h2>
        <p className="mt-1 text-sm text-text-dim">Intents your vault won and funded. Each one advanced capital to a recipient before canonical settlement returned it.</p>
        {targets.map((id) => (
          <div key={id} className="mt-4">
            <div className="flex items-center gap-2">
              <ChainBadge chainId={id} />
              <span className="num text-[11px] text-text-dim">{CHAINS[id]?.name}</span>
            </div>
            <FillsTable state={statusOf(id).fills} />
          </div>
        ))}
      </section>
    </div>
  );
}

function GasRows({
  targets,
  progressOf,
  enabled,
  onSend,
}: {
  targets: readonly number[];
  progressOf: (chainId: number) => ChainProgress;
  enabled: boolean;
  onSend: (chainId: number) => Promise<void>;
}) {
  return (
    <ul className="mt-3 space-y-2">
      {targets.map((id) => {
        const p = progressOf(id);
        return (
          <li key={id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 px-3 py-2">
            <ChainBadge chainId={id} />
            <button
              type="button"
              disabled={!enabled || p.gasSending || p.gasTxHash !== null}
              onClick={() => void onSend(id)}
              className="ml-auto rounded-lg border border-acid/60 bg-acid/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-acid disabled:opacity-50"
            >
              {p.gasTxHash ? "Gas sent" : p.gasSending ? "Sending…" : `Send ${gasTopUpFor(id).label}`}
            </button>
            {p.gasError ? <p className="w-full text-xs text-warning">{p.gasError}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function AuthoriseRows({
  targets,
  progressOf,
  statusOf,
  enabled,
  onAuthorise,
}: {
  targets: readonly number[];
  progressOf: (chainId: number) => ChainProgress;
  statusOf: (chainId: number) => ChainStatus;
  enabled: boolean;
  onAuthorise: (chainId: number) => Promise<void>;
}) {
  return (
    <ul className="mt-3 space-y-2">
      {targets.map((id) => {
        const p = progressOf(id);
        const authorised = statusOf(id).authorised;
        return (
          <li key={id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 px-3 py-2">
            <ChainBadge chainId={id} />
            <span className="num text-[11px] text-text-dim">{p.vaultAddress ? truncateAddress(p.vaultAddress) : "deploy first"}</span>
            <button
              type="button"
              disabled={!enabled || !p.vaultAddress || authorised || p.authorising}
              onClick={() => void onAuthorise(id)}
              className="ml-auto rounded-lg border border-acid/60 bg-acid/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-acid disabled:opacity-50"
            >
              {authorised ? "Authorised" : p.authorising ? "Signing…" : "Authorise (one signature)"}
            </button>
            {p.authoriseError ? <p className="w-full text-xs text-warning">{p.authoriseError}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function VaultHealth({ status }: { status: ChainStatus }) {
  const { chainId, metrics, telemetry, live } = status;
  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-2xl uppercase text-newsprint">Vault health</h2>
        <span className={`num rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${live ? "border-success/50 bg-success/10 text-success" : "border-border bg-surface-raised text-text-dim"}`}>
          {live ? "Live" : "Standby"}
        </span>
        <ChainBadge chainId={chainId} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {(
          [
            { k: "Available capital", tone: "text-text", f: (m: SolverMetrics) => (m.availableLiquidity === null ? NOT_AVAILABLE : formatUsdc(m.availableLiquidity)) },
            { k: "Outstanding exposure", tone: "text-gold-glow", f: (m: SolverMetrics) => (m.outstandingExposure === null ? NOT_AVAILABLE : formatUsdc(m.outstandingExposure)) },
            { k: "Successful fills", tone: "text-electric-glow", f: (m: SolverMetrics) => (m.transactionCount === null ? NOT_AVAILABLE : `${m.transactionCount}`) },
            { k: "Lifetime fees", tone: "text-acid", f: (m: SolverMetrics) => (m.totalFees === null ? NOT_AVAILABLE : formatUsdc(m.totalFees)) },
            { k: "Settled volume", tone: "text-text", f: (m: SolverMetrics) => (m.totalVolume === null ? NOT_AVAILABLE : formatUsdc(m.totalVolume)) },
            { k: "Utilisation", tone: "text-text", f: (m: SolverMetrics) => (m.utilisationBps === null ? NOT_AVAILABLE : formatBps(m.utilisationBps)) },
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
        <p className="num mt-1 text-sm text-text">{metrics.status === "ready" && metrics.data.runtimeStatus ? metrics.data.runtimeStatus : "Awaiting solver"}</p>
        <p className="num mt-1 text-xs text-text-dim">
          Heartbeat{" "}
          <StateValue state={telemetry} format={(t) => (t.lastHeartbeatAt === null ? <>{NOT_AVAILABLE}</> : <TimeValue at={t.lastHeartbeatAt} />)} fallback="Telemetry unavailable" />
        </p>
      </div>
      <AwaitingSource>Vault reads and telemetry heartbeat, once your vault is deployed</AwaitingSource>
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
