/**
 * SolverVaults controlled by the connected owner (Privy identity).
 *
 * WIRE: owner address -> Factory/Registry `VaultCreated(owner, vault)` events, or
 * `owner()` checks against known vaults. Then per-vault contract reads.
 *
 * Capabilities are read from the deployed vault ABI (vaultCapabilitiesFromAbi);
 * owner safety controls (pause / revoke / replace solver) are only rendered when
 * the ABI actually exposes them.
 */
import { chainConfig } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address, SolverAuthState, SolverKind } from "@/lib/arcaidia/types";
import type { VaultCapability } from "@/lib/arcaidia/abis";

export interface OwnedVaultRow {
  chainId: number;
  vaultAddress: Address;
  label: string | null;
  authorisedSolver: Address | null;
  solverAuthState: SolverAuthState | null;
  solverKind: SolverKind | null;
  capabilities: Record<VaultCapability, boolean> | null;
}

export function useOwnedVaults(owner: Address | null): DataState<OwnedVaultRow[]> {
  if (!owner) return unavailableState("Connect wallet");
  const discoverable = [chainConfig(11155111), chainConfig(5042002)].some(
    (c) => c?.vaultFactory || c?.houseVault,
  );
  if (!discoverable) return unavailableState("No vault registry deployed yet");
  // TODO(integration): discover vaults owned by this address.
  return unavailableState("Vault discovery not connected");
}
