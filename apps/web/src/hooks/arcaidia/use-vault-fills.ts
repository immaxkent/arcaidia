/**
 * Realised fills (successful, winning) and non-realised activity for a vault.
 *
 * WIRE: The Graph (chainConfig(chainId).subgraphUrl):
 *   fills    -> intent id, route, token, amount advanced, fee earned, fast-fill
 *               timestamp, canonical settlement timestamp, latency, tx hashes
 *   activity -> lost races, reverts, policy rejections, expiries (kept separate
 *               from realised performance)
 *
 * Tables start empty. `empty` is only returned when the indexer answers with
 * zero rows.
 */
import { chainConfig } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { ActivityRow, Address, FillRow } from "@/lib/arcaidia/types";

export function useVaultFills(chainId: number, vaultAddress: Address | null): DataState<FillRow[]> {
  if (!vaultAddress) return unavailableState("Select a vault");
  if (!chainConfig(chainId)?.subgraphUrl) return unavailableState("Indexer not connected");
  // TODO(integration): query indexed fills for this vault.
  return unavailableState("Indexer not connected");
}

export function useVaultActivity(
  chainId: number,
  vaultAddress: Address | null,
): DataState<ActivityRow[]> {
  if (!vaultAddress) return unavailableState("Select a vault");
  if (!chainConfig(chainId)?.subgraphUrl) return unavailableState("Indexer not connected");
  // TODO(integration): query indexed non-winning outcomes for this vault.
  return unavailableState("Indexer not connected");
}
