/**
 * Vault directory + single-vault current state.
 *
 * SOURCE:
 *   Directory     -> the chain: `ArcaidiaVaultFactory.vaultCount()`/`vaults(i)` (WP-26, D10) —
 *                    every vault the factory ever created, visible the block it's created, no
 *                    indexer in the loop. The committed House Vault is added unconditionally as
 *                    a belt-and-braces default. The Nest's `vaults` view contributes only the
 *                    creator's label (best-effort; blank until re-seeded).
 *   Current state -> direct contract reads via solverVaultAbi (liquidity, exposure, paused, owner)
 *   Aggregates    -> Arcaidia's shared, unlimited indexer (WP-22/23): `vault.fill_count` and
 *                    `protocol_state.total_fees_earned`. V1 has exactly one vault per chain, so
 *                    that chain's protocol_state row is this vault's lifetime fee figure (LP +
 *                    protocol combined — the indexer's own mapping sums both into one running
 *                    total, see subgraph/src/vault.ts's handleFeesAccrued, which the Nest is
 *                    seeded from). Missing/unreachable indexer degrades these two fields to null
 *                    rather than failing the whole row — the RPC-sourced fields are the more
 *                    load-bearing ones.
 *
 * `authorisedSolver` stays null: the real vault tracks an arbitrary *set* of
 * authorised signers (`isAuthorisedSigner`), not a single queryable address —
 * reading "the" current signer needs indexed `AuthorisedSignerSet` history,
 * which The Graph wiring will supply. Fields the deployed contracts do not
 * expose yet must stay `null` so the UI can render `--` instead of a
 * fabricated number.
 */
import { useQuery } from "@tanstack/react-query";
import { feeBpsAt, type FeePolicy } from "@arcaidia/domain";
import { solverVaultAbi } from "@/lib/arcaidia/abis";
import { factoryVaultsFromChain, vaultLabelsFromChain } from "@/lib/arcaidia/chain-history";
import { chainConfig } from "@/lib/arcaidia/config";
import {
  errorState,
  readyState,
  unavailableState,
  type DataState,
} from "@/lib/arcaidia/data-state";
import { queryNest, queryVaultRow, sqlHex20Literal } from "@/lib/arcaidia/nest";
import type { Address, OperatorType, VaultStatus } from "@/lib/arcaidia/types";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";

interface VaultAggregates {
  successfulFillCount: number | null;
  lifetimeFees: bigint | null;
}

export async function readVaultAggregates(
  chainId: number,
  vaultAddress: Address,
): Promise<VaultAggregates> {
  const endpoint = chainConfig(chainId)?.subgraphUrl;
  if (!endpoint) return { successfulFillCount: null, lifetimeFees: null };

  try {
    const idLiteral = sqlHex20Literal(vaultAddress);
    const [vaultResult, protocolStateResult] = await Promise.all([
      queryVaultRow<{ fill_count: number }>(endpoint, "fill_count", idLiteral),
      queryNest<{ total_fees_earned: string }>(
        endpoint,
        "SELECT total_fees_earned FROM protocol_state WHERE id = 'arcaidia'",
      ),
    ]);

    return {
      successfulFillCount: vaultResult.rows[0] ? Number(vaultResult.rows[0].fill_count) : null,
      lifetimeFees: protocolStateResult.rows[0] ? BigInt(protocolStateResult.rows[0].total_fees_earned) : null,
    };
  } catch {
    // Indexer hiccup degrades to unavailable for these two fields only —
    // never fabricated, and never taken down the whole vault row with it.
    return { successfulFillCount: null, lifetimeFees: null };
  }
}

/** Vault row where every not-yet-readable field is explicitly null. */
export interface VaultDirectoryRow {
  chainId: number;
  vaultAddress: Address;
  operatorLabel: string | null;
  operatorType: OperatorType;
  ownerAddress: Address | null;
  availableLiquidity: bigint | null;
  outstandingExposure: bigint | null;
  utilisationBps: number | null;
  /** "tiered-v1" for every factory vault (D7): four utilisation bands, fixed at creation. */
  pricingModelId: string | null;
  /** The vault's posted tier right now — `currentFeeBps()` read from the chain. */
  currentFeeBps: number | null;
  /** The immutable policy behind it — `feePolicy()` read from the chain. */
  feePolicy: FeePolicy | null;
  successfulFillCount: number | null;
  lifetimeFees: bigint | null;
  status: VaultStatus | null;
  authorisedSolver: Address | null;
  /** Telemetry pairing only — NOT authorisation. */
  telemetryPaired: boolean | null;
  /** Where this vault expects canonical settlement from (`settlementReceiver()`); null if unreadable. */
  settlementReceiver: Address | null;
  /** True when that is the protocol's current receiver (D12) — false means the owner must re-point it. */
  settlementReceiverCurrent: boolean | null;
}

const POLL_INTERVAL_MS = 45_000;

function utilisationBps(available: bigint, exposure: bigint): number | null {
  const total = available + exposure;
  if (total === 0n) return 0;
  return Number((exposure * 10_000n) / total);
}

/** `feePolicy()`'s public struct getter returns the seven uint16s in declaration order. */
function feePolicyFromTuple(raw: unknown): FeePolicy | null {
  if (!Array.isArray(raw) || raw.length !== 7) return null;
  const [baseFeeBps, midFeeBps, highFeeBps, criticalFeeBps, midThresholdBps, highThresholdBps, criticalThresholdBps] =
    raw.map(Number) as [number, number, number, number, number, number, number];
  if ([baseFeeBps, midFeeBps, highFeeBps, criticalFeeBps, midThresholdBps, highThresholdBps, criticalThresholdBps].some(Number.isNaN)) {
    return null;
  }
  return { baseFeeBps, midFeeBps, highFeeBps, criticalFeeBps, midThresholdBps, highThresholdBps, criticalThresholdBps };
}

async function readVaultRow(
  chainId: number,
  vaultAddress: Address,
  houseVault: Address | null,
  label: string | null = null,
): Promise<VaultDirectoryRow> {
  const client = publicClientFor(chainId);
  if (!client) throw new Error("RPC not configured");
  const read = (functionName: "owner" | "availableLiquidity" | "outstandingExposure" | "paused" | "currentFeeBps" | "feePolicy" | "settlementReceiver") =>
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName });
  const [owner, availableLiquidity, outstandingExposure, paused, rawFeeBps, rawPolicy, aggregates, receiver] = await Promise.all([
    read("owner") as Promise<Address>,
    read("availableLiquidity") as Promise<bigint>,
    read("outstandingExposure") as Promise<bigint>,
    read("paused") as Promise<boolean>,
    // v2-only surface (D7). A vault that predates the fee policy (the retired v1 House Vault,
    // until WP-31) reverts here; that degrades these two fields to null rather than hiding the
    // vault — the liquidity/exposure/status reads are the load-bearing ones.
    (read("currentFeeBps") as Promise<number>).catch(() => null),
    (read("feePolicy") as Promise<unknown>).catch(() => null),
    readVaultAggregates(chainId, vaultAddress),
    (read("settlementReceiver") as Promise<Address>).catch(() => null),
  ]);
  const currentReceiver = chainConfig(chainId)?.settlementReceiver ?? null;

  const isHouse = houseVault !== null && vaultAddress.toLowerCase() === houseVault.toLowerCase();
  const feePolicy = feePolicyFromTuple(rawPolicy);
  const currentFeeBps = rawFeeBps !== null && Number.isFinite(Number(rawFeeBps)) ? Number(rawFeeBps) : null;
  return {
    chainId,
    vaultAddress,
    operatorLabel: isHouse ? "Arcaidia House Vault" : label,
    operatorType: isHouse ? "HOUSE" : "INDEPENDENT",
    ownerAddress: owner,
    availableLiquidity,
    outstandingExposure,
    utilisationBps: utilisationBps(availableLiquidity, outstandingExposure),
    pricingModelId: feePolicy ? "tiered-v1" : null,
    currentFeeBps,
    feePolicy,
    successfulFillCount: aggregates.successfulFillCount,
    lifetimeFees: aggregates.lifetimeFees,
    status: paused ? "PAUSED" : "ACTIVE",
    authorisedSolver: null,
    telemetryPaired: null,
    settlementReceiver: receiver,
    settlementReceiverCurrent: receiver && currentReceiver ? receiver.toLowerCase() === currentReceiver.toLowerCase() : null,
  };
}

interface DiscoveredVault {
  address: Address;
  label: string | null;
}

/**
 * The vault directory (D10) — read from the chain, not an indexer.
 *
 * `ArcaidiaVaultFactory` *is* the registry: `vaultCount()` / `vaults(i)` list every vault it
 * ever created, so a vault someone deploys on /earn is visible here in the same block, with
 * no indexer in the loop at all. The creator's label lives in the `VaultCreated` event (not in
 * factory storage), so it is read from the factory's own logs — also chain-only. The Nest's
 * `vaults` view is consulted only for a label the log read could not supply.
 */
async function discoverParticipantVaults(chainId: number): Promise<DiscoveredVault[]> {
  const config = chainConfig(chainId);
  const [fromChain, chainLabels] = await Promise.all([
    factoryVaultsFromChain(chainId),
    vaultLabelsFromChain(chainId).catch(() => new Map<string, { label: string }>()),
  ]);

  const labels = new Map<string, string>();
  for (const [key, created] of chainLabels) if (created.label) labels.set(key, created.label);

  const unlabelled = fromChain.filter((address) => !labels.has(address.toLowerCase()));
  if (unlabelled.length > 0 && config?.subgraphUrl) {
    try {
      const result = await queryNest<{ id: string; label: string | null }>(config.subgraphUrl, "SELECT id, label FROM vaults");
      for (const row of result.rows) if (row.label && !labels.has(row.id.toLowerCase())) labels.set(row.id.toLowerCase(), row.label);
    } catch {
      // Not re-seeded yet, or unreachable — the chain already supplied every label it can.
    }
  }

  return fromChain.map((address) => ({ address, label: labels.get(address.toLowerCase()) ?? null }));
}

async function fetchVaultDirectory(chainId: number, houseVault: Address | null): Promise<VaultDirectoryRow[]> {
  const participants = await discoverParticipantVaults(chainId);
  // Keyed by lowercase for dedup, valued by one real, original-case address
  // to read from and display — the committed houseVault's own casing wins
  // for that one address, since it's already the canonical form used
  // everywhere else in the app.
  const byKey = new Map<string, DiscoveredVault>(participants.map((v) => [v.address.toLowerCase(), v]));
  if (houseVault) byKey.set(houseVault.toLowerCase(), { address: houseVault, label: byKey.get(houseVault.toLowerCase())?.label ?? null });
  if (byKey.size === 0) return [];

  const rows = await Promise.all(
    [...byKey.values()].map((v) => readVaultRow(chainId, v.address, houseVault, v.label)),
  );
  // House Vault first, then by available liquidity — a stable, meaningful order rather than
  // whatever arbitrary order the SQL/Set iteration happened to produce.
  return rows.sort((a, b) => {
    if (a.operatorType !== b.operatorType) return a.operatorType === "HOUSE" ? -1 : 1;
    return (b.availableLiquidity ?? 0n) > (a.availableLiquidity ?? 0n) ? 1 : -1;
  });
}

export function useVaults(chainId: number): DataState<VaultDirectoryRow[]> {
  const config = chainConfig(chainId);
  const houseVault = config?.houseVault ?? null;
  const enabled = Boolean(config?.rpcUrl);

  const query = useQuery({
    queryKey: ["vault-directory", chainId, houseVault],
    queryFn: () => fetchVaultDirectory(chainId, houseVault),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });

  if (!config?.rpcUrl) return unavailableState("RPC not configured");
  if (query.isError)
    return errorState(query.error instanceof Error ? query.error.message : "Read failed");
  if (!query.data) return unavailableState("Vault directory not connected");
  if (query.data.length === 0) return unavailableState("No vaults deployed on this chain yet");
  return readyState(query.data);
}

export function useVault(
  chainId: number,
  vaultAddress: Address | null,
): DataState<VaultDirectoryRow> {
  const config = chainConfig(chainId);
  const houseVault = config?.houseVault ?? null;
  const enabled = Boolean(vaultAddress && config?.rpcUrl);

  const query = useQuery({
    queryKey: ["vault-detail", chainId, vaultAddress],
    queryFn: () => readVaultRow(chainId, vaultAddress as Address, houseVault),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });

  if (!vaultAddress) return unavailableState("Select a vault");
  if (!config?.rpcUrl) return unavailableState("RPC not configured");
  if (query.isError)
    return errorState(query.error instanceof Error ? query.error.message : "Read failed");
  if (!query.data) return unavailableState("Vault reads not connected");
  return readyState(query.data);
}

export interface VaultAnalytics {
  /** Historical points derived from indexed events. Never generated. */
  volumeSeries: Array<{ at: number; value: bigint }>;
  feeSeries: Array<{ at: number; value: bigint }>;
  utilisationSeries: Array<{ at: number; bps: number }>;
  /**
   * The vault's posted fee tier at each utilisation point — `feeBpsAt(policy, utilisation)`,
   * the same step function the contract runs (D7). Empty when the policy could not be read
   * from the chain, never guessed.
   */
  feeTierSeries: Array<{ at: number; bps: number }>;
  /**
   * The raw balance/exposure this vault's own `utilisationSeries` was
   * derived from, at each event — kept so a caller combining *several*
   * vaults into one ecosystem-wide aggregate can sum real balances and
   * exposures first and take one ratio, rather than averaging each vault's
   * already-computed percentage (which is not the same number).
   */
  stateSeries: Array<{ at: number; balance: bigint; exposure: bigint }>;
}

interface RawDeposit {
  assets: string;
  block_timestamp: number;
}
interface RawWithdraw {
  assets: string;
  block_timestamp: number;
}
interface RawFastFilled {
  outputAmount: string;
  block_timestamp: number;
}
interface RawReimbursement {
  amountReceived: string;
  exposureCleared: string;
  block_timestamp: number;
}

type BalanceEvent =
  | { at: number; kind: "deposit"; assets: bigint }
  | { at: number; kind: "withdraw"; assets: bigint }
  | { at: number; kind: "fill"; outputAmount: bigint }
  | { at: number; kind: "reimburse"; amountReceived: bigint; exposureCleared: bigint };

/**
 * Reconstructs `{liquidBalance, outstandingExposure}` over time by replaying
 * this vault's own raw events in order — the Nest keeps every one
 * (`liquidity_vault__deposit/withdraw/fast_filled/reimbursement_recorded`),
 * it just doesn't keep a ready-made history of the *derived* balance/exposure
 * themselves. Mirrors `ArcaidiaLiquidityVault`'s own accounting exactly:
 * deposit/withdraw move `liquidBalance` directly; a fastFill moves
 * `outputAmount` from balance into exposure; a reimbursement moves
 * `exposureCleared` back out of exposure and `amountReceived` (the fuller
 * CCTP-bridged amount) into balance — the difference between those two is
 * exactly the fee that lands as LP profit.
 */
async function fetchBalanceEvents(endpoint: string, vaultAddress: Address): Promise<BalanceEvent[]> {
  const idLiteral = sqlHex20Literal(vaultAddress);
  const [deposits, withdraws, fills, reimbursements] = await Promise.all([
    queryNest<RawDeposit>(
      endpoint,
      `SELECT assets, block_timestamp FROM liquidity_vault__deposit WHERE address = ${idLiteral} ORDER BY block_timestamp ASC`,
    ),
    queryNest<RawWithdraw>(
      endpoint,
      `SELECT assets, block_timestamp FROM liquidity_vault__withdraw WHERE address = ${idLiteral} ORDER BY block_timestamp ASC`,
    ),
    queryNest<RawFastFilled>(
      endpoint,
      `SELECT outputAmount, block_timestamp FROM liquidity_vault__fast_filled WHERE address = ${idLiteral} ORDER BY block_timestamp ASC`,
    ),
    queryNest<RawReimbursement>(
      endpoint,
      `SELECT amountReceived, exposureCleared, block_timestamp FROM liquidity_vault__reimbursement_recorded WHERE address = ${idLiteral} ORDER BY block_timestamp ASC`,
    ),
  ]);

  const events: BalanceEvent[] = [
    ...deposits.rows.map((d): BalanceEvent => ({ at: d.block_timestamp, kind: "deposit", assets: BigInt(d.assets) })),
    ...withdraws.rows.map((w): BalanceEvent => ({ at: w.block_timestamp, kind: "withdraw", assets: BigInt(w.assets) })),
    ...fills.rows.map((f): BalanceEvent => ({ at: f.block_timestamp, kind: "fill", outputAmount: BigInt(f.outputAmount) })),
    ...reimbursements.rows.map(
      (r): BalanceEvent => ({
        at: r.block_timestamp,
        kind: "reimburse",
        amountReceived: BigInt(r.amountReceived),
        exposureCleared: BigInt(r.exposureCleared),
      }),
    ),
  ];
  return events.sort((a, b) => a.at - b.at);
}

export async function fetchVaultAnalyticsData(chainId: number, vaultAddress: Address): Promise<VaultAnalytics> {
  const endpoint = chainConfig(chainId)?.subgraphUrl;
  if (!endpoint) throw new Error("Indexer not connected");

  const idLiteral = sqlHex20Literal(vaultAddress);
  const [events, policy, currentRowResult] = await Promise.all([
    fetchBalanceEvents(endpoint, vaultAddress),
    readFeePolicy(chainId, vaultAddress),
    queryVaultRow<{ liquid_balance: string; outstanding_exposure: string }>(
      endpoint,
      "liquid_balance, outstanding_exposure",
      idLiteral,
    ),
  ]);

  let balance = 0n;
  let exposure = 0n;
  let cumulativeVolume = 0n;
  let cumulativeFees = 0n;
  const utilisationSeries: VaultAnalytics["utilisationSeries"] = [];
  const volumeSeries: VaultAnalytics["volumeSeries"] = [];
  const feeSeries: VaultAnalytics["feeSeries"] = [];
  const stateSeries: VaultAnalytics["stateSeries"] = [];

  for (const event of events) {
    if (event.kind === "deposit") balance += event.assets;
    else if (event.kind === "withdraw") balance -= event.assets;
    else if (event.kind === "fill") {
      balance -= event.outputAmount;
      exposure += event.outputAmount;
      cumulativeVolume += event.outputAmount;
      volumeSeries.push({ at: event.at, value: cumulativeVolume });
    } else {
      balance += event.amountReceived;
      exposure -= event.exposureCleared;
      cumulativeFees += event.amountReceived - event.exposureCleared;
      feeSeries.push({ at: event.at, value: cumulativeFees });
    }

    const total = balance + exposure;
    utilisationSeries.push({ at: event.at, bps: total === 0n ? 0 : Number((exposure * 10_000n) / total) });
    stateSeries.push({ at: event.at, balance, exposure });
  }

  // The load-bearing check: replaying every event this vault has ever
  // emitted must land on exactly the balance/exposure the contract itself
  // reports right now. A mismatch means either a missing event type or a
  // wrong accounting rule above — better to refuse the chart outright than
  // show one that's silently wrong.
  const currentRow = currentRowResult.rows[0];
  if (currentRow) {
    const realBalance = BigInt(currentRow.liquid_balance);
    const realExposure = BigInt(currentRow.outstanding_exposure);
    if (balance !== realBalance || exposure !== realExposure) {
      throw new Error(
        "Reconstructed vault history does not match the vault's current on-chain state — refusing to show a potentially incorrect chart.",
      );
    }
  }

  const feeTierSeries = policy ? utilisationSeries.map((p) => ({ at: p.at, bps: feeBpsAt(policy, p.bps) })) : [];
  return { volumeSeries, feeSeries, utilisationSeries, feeTierSeries, stateSeries };
}

/** The vault's immutable policy, from the chain; `null` when no RPC is configured or the read fails. */
async function readFeePolicy(chainId: number, vaultAddress: Address): Promise<FeePolicy | null> {
  const client = publicClientFor(chainId);
  if (!client) return null;
  try {
    return feePolicyFromTuple(
      await client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "feePolicy" }),
    );
  } catch {
    return null;
  }
}

const ANALYTICS_POLL_INTERVAL_MS = 30_000;

export function useVaultAnalytics(
  chainId: number,
  vaultAddress: Address | null,
): DataState<VaultAnalytics> {
  const endpoint = chainConfig(chainId)?.subgraphUrl;
  const enabled = Boolean(vaultAddress && endpoint);

  const query = useQuery({
    queryKey: ["vault-analytics", chainId, vaultAddress],
    queryFn: () => fetchVaultAnalyticsData(chainId, vaultAddress as Address),
    enabled,
    refetchInterval: ANALYTICS_POLL_INTERVAL_MS,
  });

  if (!vaultAddress) return unavailableState("Select a vault");
  if (!endpoint) return unavailableState("Indexer not connected");
  if (query.isError) {
    return errorState(query.error instanceof Error ? query.error.message : "Indexer query failed");
  }
  if (!query.data) return unavailableState("Indexer not connected");
  return readyState(query.data);
}

export interface AggregateVaultState {
  liquidity: bigint;
  exposure: bigint;
  utilisationBps: number;
}

/**
 * Liquidity/exposure/utilisation summed across a chain's vault directory.
 *
 * Not the x402 market intelligence service (useMarketIntelligence) — that one
 * covers fields genuinely requiring a backend (fee-quote history, per-fill
 * settlement latency percentiles). "Aggregate liquidity" needs none of that:
 * V1 has exactly one vault per chain, so it's honestly just that vault's own
 * `availableLiquidity`/`outstandingExposure`, already fetched by `useVaults`.
 * Requires every row's figures to be present — with one row today, a partial
 * sum would just be silently wrong rather than merely incomplete.
 */
export function useAggregateVaultState(
  directory: DataState<readonly VaultDirectoryRow[]>,
): DataState<AggregateVaultState> {
  if (directory.status !== "ready") return unavailableState("Vault directory not connected");
  if (directory.data.length === 0) return unavailableState("No vaults in this directory yet");

  let liquidity = 0n;
  let exposure = 0n;
  for (const row of directory.data) {
    if (row.availableLiquidity === null || row.outstandingExposure === null) {
      return unavailableState("One or more vault reads are incomplete");
    }
    liquidity += row.availableLiquidity;
    exposure += row.outstandingExposure;
  }

  const total = liquidity + exposure;
  const utilisationBps = total === 0n ? 0 : Number((exposure * 10_000n) / total);

  return readyState({ liquidity, exposure, utilisationBps });
}
