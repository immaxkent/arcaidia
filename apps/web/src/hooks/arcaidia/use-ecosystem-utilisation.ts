/**
 * Utilisation over time, across every vault in a chain's directory — one
 * line per vault, plus one aggregated line, for the Solver Console's
 * ecosystem-wide chart.
 *
 * Deliberately its own hook, not `vaults.map(v => useVaultAnalytics(...))`:
 * the vault list's length changes as the market gains participants, and
 * calling a hook a variable number of times per render breaks the rules of
 * hooks. One `useQuery` whose `queryFn` fans out to `fetchVaultAnalyticsData`
 * per vault sidesteps that entirely.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchVaultAnalyticsData, type VaultDirectoryRow } from "./use-vaults";
import { readyState, unavailableState, errorState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address } from "@/lib/arcaidia/types";

export interface UtilisationPoint {
  readonly at: number;
  readonly bps: number;
}

export interface VaultUtilisationLine {
  readonly vaultAddress: Address;
  readonly label: string;
  readonly points: readonly UtilisationPoint[];
}

export interface EcosystemUtilisation {
  readonly perVault: readonly VaultUtilisationLine[];
  readonly aggregate: readonly UtilisationPoint[];
}

function bpsOf(balance: bigint, exposure: bigint): number {
  const total = balance + exposure;
  return total === 0n ? 0 : Number((exposure * 10_000n) / total);
}

/** The most recent state at or before `at`, from a series already sorted ascending by `at`. */
function stateAsOf<T extends { at: number }>(series: readonly T[], at: number): T | null {
  let found: T | null = null;
  for (const point of series) {
    if (point.at > at) break;
    found = point;
  }
  return found;
}

async function fetchEcosystemUtilisation(
  chainId: number,
  vaults: readonly VaultDirectoryRow[],
): Promise<EcosystemUtilisation> {
  const perVaultData = await Promise.all(
    vaults.map(async (vault) => {
      const analytics = await fetchVaultAnalyticsData(chainId, vault.vaultAddress);
      return {
        vaultAddress: vault.vaultAddress,
        label: vault.operatorLabel ?? `${vault.vaultAddress.slice(0, 6)}…${vault.vaultAddress.slice(-4)}`,
        stateSeries: analytics.stateSeries,
      };
    }),
  );

  const perVault: VaultUtilisationLine[] = perVaultData.map((v) => ({
    vaultAddress: v.vaultAddress,
    label: v.label,
    points: v.stateSeries.map((p) => ({ at: p.at, bps: bpsOf(p.balance, p.exposure) })),
  }));

  // The aggregate's timeline is every timestamp *any* vault's state changed
  // at — at each one, every vault contributes its own latest known state as
  // of that instant (forward-filled; a vault with no history yet at that
  // point contributes 0/0), summed before taking one ratio. Averaging each
  // vault's own already-computed percentage instead would weight a small
  // vault's utilisation exactly as heavily as a large one's — not what
  // "ecosystem-wide utilisation" means.
  const timestamps = [...new Set(perVaultData.flatMap((v) => v.stateSeries.map((p) => p.at)))].sort(
    (a, b) => a - b,
  );

  const aggregate: UtilisationPoint[] = timestamps.map((at) => {
    let totalBalance = 0n;
    let totalExposure = 0n;
    for (const v of perVaultData) {
      const state = stateAsOf(v.stateSeries, at);
      if (state) {
        totalBalance += state.balance;
        totalExposure += state.exposure;
      }
    }
    return { at, bps: bpsOf(totalBalance, totalExposure) };
  });

  return { perVault, aggregate };
}

const POLL_INTERVAL_MS = 30_000;

export function useEcosystemUtilisation(
  chainId: number,
  vaults: DataState<readonly VaultDirectoryRow[]>,
): DataState<EcosystemUtilisation> {
  const vaultList = vaults.status === "ready" ? vaults.data : [];
  const enabled = vaults.status === "ready" && vaultList.length > 0;

  const query = useQuery({
    queryKey: ["ecosystem-utilisation", chainId, vaultList.map((v) => v.vaultAddress)],
    queryFn: () => fetchEcosystemUtilisation(chainId, vaultList),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  });

  if (vaults.status === "loading") return { status: "loading" };
  if (vaults.status !== "ready") return unavailableState("Vault directory not connected");
  if (vaultList.length === 0) return unavailableState("No vaults in this directory yet");
  if (query.isError) {
    return errorState(query.error instanceof Error ? query.error.message : "Indexer query failed");
  }
  if (!query.data) return unavailableState("Indexer not connected");
  return readyState(query.data);
}
