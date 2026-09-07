/**
 * Vault directory + single-vault current state.
 *
 * SOURCE:
 *   V1            -> one Arcaidia House Vault per chain: chainConfig(chainId).houseVault
 *   Intent Market -> additional SolverVaults discovered from Factory/Registry events — not yet wired
 *   Current state -> direct contract reads via solverVaultAbi (liquidity, exposure, paused, owner)
 *   Aggregates    -> The Graph (fill count, lifetime fees, volume) — not yet wired
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
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address, OperatorType, VaultStatus } from "@/lib/arcaidia/types";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";

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

async function readHouseVaultRow(chainId: number, vaultAddress: Address): Promise<VaultDirectoryRow> {
  const client = publicClientFor(chainId);
  if (!client) throw new Error("RPC not configured");
  const [owner, availableLiquidity, outstandingExposure, paused] = await Promise.all([
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "owner" }),
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "availableLiquidity" }),
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "outstandingExposure" }),
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "paused" }),
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
    successfulFillCount: null,
    lifetimeFees: null,
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

  if (!houseVault && !config?.vaultFactory) return unavailableState("No vaults deployed on this chain yet");
  if (!houseVault) return unavailableState("Vault registry not connected");
  if (!config?.rpcUrl) return unavailableState("RPC not configured");
  if (query.isError) return errorState(query.error instanceof Error ? query.error.message : "Read failed");
  if (!query.data) return unavailableState("Vault registry not connected");
  return readyState([query.data]);
}

export function useVault(chainId: number, vaultAddress: Address | null): DataState<VaultDirectoryRow> {
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
  if (query.isError) return errorState(query.error instanceof Error ? query.error.message : "Read failed");
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
