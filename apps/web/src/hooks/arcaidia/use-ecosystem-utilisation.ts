/**
 * Utilisation over time, across every vault the app knows about — one line
 * per vault, plus one aggregated line, for `/liquidity`'s ecosystem-wide
 * chart. Genuinely cross-chain: each vault carries its own `chainId`
 * (`VaultDirectoryRow.chainId`), so a caller can pass in a single chain's
 * directory or every chain's merged together and this fetches and sums each
 * vault against the chain it actually lives on either way. Combining
 * balances/exposures across chains is meaningful here specifically because
 * every vault in this app, on every supported chain, holds the same asset —
 * USDC — so a protocol-wide USDC utilisation ratio is a real number, not an
 * apples-to-oranges blend.
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
import { CHAINS, type Address } from "@/lib/arcaidia/types";

export interface UtilisationPoint {
  readonly at: number;
  readonly bps: number;
}

export interface VaultUtilisationLine {
  /**
   * `${chainId}:${vaultAddress}`, not the address alone — Arcaidia deploys
   * through CREATE2 with identical salts, so the House Vault has the exact
   * same address on every chain (the recurring source of duplicate-key bugs
   * elsewhere in this app). A chart merging vaults across chains needs a key
   * that stays unique even when the address doesn't.
   */
  readonly key: string;
  readonly chainId: number;
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

async function fetchEcosystemUtilisation(vaults: readonly VaultDirectoryRow[]): Promise<EcosystemUtilisation> {
  const perVaultData = await Promise.all(
    vaults.map(async (vault) => {
      const analytics = await fetchVaultAnalyticsData(vault.chainId, vault.vaultAddress);
      const shortLabel = `${vault.vaultAddress.slice(0, 6)}…${vault.vaultAddress.slice(-4)}`;
      return {
        key: `${vault.chainId}:${vault.vaultAddress}`,
        chainId: vault.chainId,
        vaultAddress: vault.vaultAddress,
        label: `${vault.operatorLabel ?? shortLabel} · ${CHAINS[vault.chainId]?.short ?? vault.chainId}`,
        stateSeries: analytics.stateSeries,
      };
    }),
  );

  const perVault: VaultUtilisationLine[] = perVaultData.map((v) => ({
    key: v.key,
    chainId: v.chainId,
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
  vaults: DataState<readonly VaultDirectoryRow[]>,
): DataState<EcosystemUtilisation> {
  const vaultList = vaults.status === "ready" ? vaults.data : [];
  const enabled = vaults.status === "ready" && vaultList.length > 0;

  const query = useQuery({
    queryKey: ["ecosystem-utilisation", vaultList.map((v) => `${v.chainId}:${v.vaultAddress}`)],
    queryFn: () => fetchEcosystemUtilisation(vaultList),
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
