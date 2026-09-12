/**
 * Vaults controlled by the connected owner (Privy identity), on both chains.
 *
 * SOURCE: the same factory-backed directory `useVaults` reads from the chain (WP-26, D10) —
 * `ArcaidiaVaultFactory.vaults(i)` plus each vault's `owner()` — filtered to rows whose owner
 * is the connected address. Nothing is remembered in browser storage: a reload re-derives the
 * list from the chain, so an owner who left /earn between steps finds their vault again.
 *
 * Capabilities are read from the deployed vault ABI (vaultCapabilitiesFromAbi); owner safety
 * controls (pause / revoke / replace solver) are only rendered when the ABI exposes them.
 */
import { solverVaultAbi, vaultCapabilitiesFromAbi, type VaultCapability } from "@/lib/arcaidia/abis";
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import { ARC_TESTNET, ETHEREUM_SEPOLIA, type Address, type SolverAuthState, type SolverKind } from "@/lib/arcaidia/types";
import { useVaults, type VaultDirectoryRow } from "./use-vaults";

export interface OwnedVaultRow {
  chainId: number;
  vaultAddress: Address;
  label: string | null;
  /** Live figures, straight from the directory row (contract reads). */
  currentFeeBps: number | null;
  availableLiquidity: bigint | null;
  outstandingExposure: bigint | null;
  authorisedSolver: Address | null;
  solverAuthState: SolverAuthState | null;
  solverKind: SolverKind | null;
  capabilities: Record<VaultCapability, boolean> | null;
}

function toOwnedRow(row: VaultDirectoryRow): OwnedVaultRow {
  return {
    chainId: row.chainId,
    vaultAddress: row.vaultAddress,
    label: row.operatorLabel,
    currentFeeBps: row.currentFeeBps,
    availableLiquidity: row.availableLiquidity,
    outstandingExposure: row.outstandingExposure,
    // The vault tracks a *set* of authorised signers, not one queryable address; the
    // authorisation fact for a specific candidate is read by useSolverMetrics.
    authorisedSolver: null,
    solverAuthState: null,
    solverKind: null,
    capabilities: vaultCapabilitiesFromAbi(solverVaultAbi as unknown as ReadonlyArray<{ type: string; name?: string }>),
  };
}

export function useOwnedVaults(owner: Address | null): DataState<OwnedVaultRow[]> {
  // Two explicit hook calls (rules of hooks), same shape as the console's market directory.
  const sepolia = useVaults(ETHEREUM_SEPOLIA);
  const arc = useVaults(ARC_TESTNET);

  if (!owner) return unavailableState("Connect wallet");
  const perChain = [sepolia, arc];
  if (perChain.some((s) => s.status === "loading")) return { status: "loading" };
  const errored = perChain.find((s) => s.status === "error");
  if (errored && errored.status === "error") return errorState(errored.error);

  const mine = perChain
    .flatMap((s) => (s.status === "ready" ? s.data : []))
    .filter((row) => row.ownerAddress?.toLowerCase() === owner.toLowerCase())
    .map(toOwnedRow);

  if (mine.length === 0) return unavailableState("No vaults owned by this wallet yet");
  return readyState(mine);
}
