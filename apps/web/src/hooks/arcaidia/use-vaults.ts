/**
 * Vault directory + single-vault current state.
 *
 * SOURCE:
 *   V1            -> one Arcaidia House Vault per chain: chainConfig(chainId).houseVault
 *   Intent Market -> additional SolverVaults discovered from Factory/Registry events — not yet wired
 *   Current state -> direct contract reads via solverVaultAbi (liquidity, exposure, paused, owner)
 *   Aggregates    -> The Graph: Vault.fillCount and ProtocolState.totalFeesEarned. V1 has exactly
 *                    one vault per chain, so that chain's ProtocolState singleton is this vault's
 *                    lifetime fee figure (LP + protocol combined — the subgraph mapping sums both
 *                    into one running total, see subgraph/src/vault.ts's handleFeesAccrued).
 *                    Missing/unreachable subgraph degrades these two fields to null rather than
 *                    failing the whole row — the RPC-sourced fields are the more load-bearing ones.
 *
 * `authorisedSolver` stays null: the real vault tracks an arbitrary *set* of
 * authorised signers (`isAuthorisedSigner`), not a single queryable address —
 * reading "the" current signer needs indexed `AuthorisedSignerSet` history,
 * which The Graph wiring will supply. Fields the deployed contracts do not
 * expose yet must stay `null` so the UI can render `--` instead of a
 * fabricated number.
 */
import { useQuery } from "@tanstack/react-query";
import { solverVaultAbi } from "@/lib/arcaidia/abis";
import { chainConfig } from "@/lib/arcaidia/config";
import {
  errorState,
  readyState,
  unavailableState,
  type DataState,
} from "@/lib/arcaidia/data-state";
import { querySubgraph } from "@/lib/arcaidia/subgraph";
import type { Address, OperatorType, VaultStatus } from "@/lib/arcaidia/types";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";

const VAULT_AGGREGATES = `
  query VaultAggregates($id: Bytes!) {
    vault(id: $id) { fillCount }
    protocolState(id: "arcaidia") { totalFeesEarned }
  }`;

interface VaultAggregates {
  successfulFillCount: number | null;
  lifetimeFees: bigint | null;
}

async function readVaultAggregates(
  chainId: number,
  vaultAddress: Address,
): Promise<VaultAggregates> {
  const endpoint = chainConfig(chainId)?.subgraphUrl;
  if (!endpoint) return { successfulFillCount: null, lifetimeFees: null };

  try {
    const data = await querySubgraph<{
      vault: { fillCount: string } | null;
      protocolState: { totalFeesEarned: string } | null;
    }>(endpoint, VAULT_AGGREGATES, { id: vaultAddress.toLowerCase() });

    return {
      successfulFillCount: data.vault ? Number(data.vault.fillCount) : null,
      lifetimeFees: data.protocolState ? BigInt(data.protocolState.totalFeesEarned) : null,
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
  pricingModelId: string | null;
  currentFeeBps: number | null;
  successfulFillCount: number | null;
  lifetimeFees: bigint | null;
  status: VaultStatus | null;
  authorisedSolver: Address | null;
  /** Telemetry pairing only — NOT authorisation. */
  telemetryPaired: boolean | null;
}

const POLL_INTERVAL_MS = 20_000;

function utilisationBps(available: bigint, exposure: bigint): number | null {
  const total = available + exposure;
  if (total === 0n) return 0;
  return Number((exposure * 10_000n) / total);
}

async function readHouseVaultRow(
  chainId: number,
  vaultAddress: Address,
): Promise<VaultDirectoryRow> {
  const client = publicClientFor(chainId);
  if (!client) throw new Error("RPC not configured");
  const [owner, availableLiquidity, outstandingExposure, paused, aggregates] = await Promise.all([
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "owner" }),
    client.readContract({
      address: vaultAddress,
      abi: solverVaultAbi,
      functionName: "availableLiquidity",
    }),
    client.readContract({
      address: vaultAddress,
      abi: solverVaultAbi,
      functionName: "outstandingExposure",
    }),
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "paused" }),
    readVaultAggregates(chainId, vaultAddress),
  ]);

  return {
    chainId,
    vaultAddress,
    operatorLabel: "Arcaidia House Vault",
    operatorType: "HOUSE",
    ownerAddress: owner,
    availableLiquidity,
    outstandingExposure,
    utilisationBps: utilisationBps(availableLiquidity, outstandingExposure),
    pricingModelId: null,
    currentFeeBps: null,
    successfulFillCount: aggregates.successfulFillCount,
    lifetimeFees: aggregates.lifetimeFees,
    status: paused ? "PAUSED" : "ACTIVE",
    authorisedSolver: null,
    telemetryPaired: null,
  };
}

export function useVaults(chainId: number): DataState<VaultDirectoryRow[]> {
  const config = chainConfig(chainId);
  const houseVault = config?.houseVault ?? null;
  const enabled = Boolean(houseVault && config?.rpcUrl);

  const query = useQuery({
    queryKey: ["vault-directory", chainId, houseVault],
    queryFn: () => readHouseVaultRow(chainId, houseVault as Address),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });

  if (!houseVault && !config?.vaultFactory)
    return unavailableState("No vaults deployed on this chain yet");
  if (!houseVault) return unavailableState("Vault registry not connected");
  if (!config?.rpcUrl) return unavailableState("RPC not configured");
  if (query.isError)
    return errorState(query.error instanceof Error ? query.error.message : "Read failed");
  if (!query.data) return unavailableState("Vault registry not connected");
  return readyState([query.data]);
}

export function useVault(
  chainId: number,
  vaultAddress: Address | null,
): DataState<VaultDirectoryRow> {
  const config = chainConfig(chainId);
  const enabled = Boolean(vaultAddress && config?.rpcUrl);

  const query = useQuery({
    queryKey: ["vault-detail", chainId, vaultAddress],
    queryFn: () => readHouseVaultRow(chainId, vaultAddress as Address),
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
}

export function useVaultAnalytics(
  chainId: number,
  vaultAddress: Address | null,
): DataState<VaultAnalytics> {
  if (!vaultAddress) return unavailableState("Select a vault");
  if (!chainConfig(chainId)?.subgraphUrl) return unavailableState("Indexer not connected");
  // TODO(integration): aggregate indexed fills into real historical series.
  return unavailableState("Indexer not connected");
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
