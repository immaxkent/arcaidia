/**
 * The connected owner's intent history (status / history surface).
 *
 * WIRE: The Graph (chainConfig(chainId).subgraphUrl) for IntentCreated events,
 * source tx hashes, fast-fill events, destination tx hashes, winning SolverVault,
 * the fee actually charged, canonical settlement status/tx and real timestamps.
 *
 * Returns `empty` only when the indexer answers with zero rows. No example rows.
 */
import { chainConfig } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address, Intent, IntentSettlementState } from "@/lib/arcaidia/types";

export interface IntentHistoryRow {
  intent: Intent;
  settlement: IntentSettlementState;
  winningVault: Address | null;
  feeCharged: bigint | null;
  destinationTxHash: string | null;
  settlementTxHash: string | null;
  settlementLatencySeconds: number | null;
}

export function useIntentHistory(
  owner: Address | null,
  chainIds: readonly number[],
): DataState<IntentHistoryRow[]> {
  if (!owner) return unavailableState("Connect wallet");
  const indexed = chainIds.some((id) => chainConfig(id)?.subgraphUrl);
  if (!indexed) return unavailableState("Indexer not connected");
  // TODO(integration): query the subgraph for this sender's intents.
  return unavailableState("Indexer not connected");
}
