/**
 * Realised fills (successful, winning) and non-realised activity for a vault.
 *
 * SOURCE (fills): The Graph, two subgraphs joined by intentId — the same
 * cross-chain join `useIntentHistory` needs, run from the opposite direction.
 * `Fill`/`Settlement` are indexed on *this* vault's own chain (its own
 * `chainConfig(chainId).subgraphUrl`); the intent's origin details
 * (sourceChainId, sourceTxHash, principal amount) live on the *other*
 * chain's subgraph, since that's where `IntentCreated` fired. V1 has exactly
 * one vault per chain, so every fill indexed on this chain came from this
 * vault by construction — no vault-address filter exists in the schema, or
 * is needed.
 *
 * SOURCE (activity): none exists yet. A lost race, a policy rejection or an
 * expiry all mean the solver never submitted a transaction at all — nothing
 * for an indexer to see. A reverted fastFill likewise emits no event a
 * subgraph could pick up. This genuinely has no queryable source until a
 * telemetry/decision-feed service exists (see useSolverDecisions), so it
 * stays `unavailable` rather than being wired to something that would just
 * always read empty and look like "no activity" instead of "not tracked yet".
 *
 * Tables start empty. `empty` is only returned when the indexer answers with
 * zero rows.
 */
import { useQuery } from "@tanstack/react-query";
import { chainConfig, SUPPORTED_CHAIN_IDS } from "@/lib/arcaidia/config";
import {
  emptyState,
  errorState,
  readyState,
  unavailableState,
  type DataState,
} from "@/lib/arcaidia/data-state";
import { querySubgraph } from "@/lib/arcaidia/subgraph";
import type { ActivityRow, Address, CanonicalStatus, FillRow, Hex } from "@/lib/arcaidia/types";

const FILLS_WITH_SETTLEMENTS = `
  query FillsWithSettlements($first: Int!) {
    fills(first: $first, orderBy: timestamp, orderDirection: desc) {
      id intentId outputAmount timestamp txHash
    }
  }`;

const SETTLEMENTS_FOR_INTENTS = `
  query SettlementsForIntents($ids: [Bytes!]!) {
    settlements(where: { intentId_in: $ids }) { intentId outcome amount timestamp txHash }
  }`;

const INTENTS_FOR_IDS = `
  query IntentsForIds($ids: [Bytes!]!) {
    intents(where: { id_in: $ids }) { id sourceChainId amount createdAtTimestamp createdTxHash }
  }`;

interface RawFill {
  id: string;
  intentId: string;
  outputAmount: string;
  timestamp: string;
  txHash: string;
}

interface RawSettlement {
  intentId: string;
  outcome: string;
  amount: string;
  timestamp: string;
  txHash: string;
}

interface RawIntent {
  id: string;
  sourceChainId: string;
  amount: string;
  createdAtTimestamp: string;
  createdTxHash: string;
}

function otherChainId(chainId: number): number | null {
  return SUPPORTED_CHAIN_IDS.find((id) => id !== chainId) ?? null;
}

async function fetchVaultFills(chainId: number): Promise<FillRow[]> {
  const endpoint = chainConfig(chainId)?.subgraphUrl;
  if (!endpoint) throw new Error("Indexer not connected");

  const { fills } = await querySubgraph<{ fills: RawFill[] }>(endpoint, FILLS_WITH_SETTLEMENTS, {
    first: 200,
  });
  if (fills.length === 0) return [];

  const ids = fills.map((fill) => fill.intentId);
  const sourceEndpoint = chainConfig(otherChainId(chainId) ?? -1)?.subgraphUrl;

  const [{ settlements }, sourceIntents] = await Promise.all([
    querySubgraph<{ settlements: RawSettlement[] }>(endpoint, SETTLEMENTS_FOR_INTENTS, { ids }),
    sourceEndpoint
      ? querySubgraph<{ intents: RawIntent[] }>(sourceEndpoint, INTENTS_FOR_IDS, { ids })
      : Promise.resolve({ intents: [] as RawIntent[] }),
  ]);

  const settlementByIntentId = new Map(settlements.map((s) => [s.intentId, s]));
  const intentByIntentId = new Map(sourceIntents.intents.map((i) => [i.id, i]));

  return fills.map((fill): FillRow => {
    const settlement = settlementByIntentId.get(fill.intentId) ?? null;
    const sourceIntent = intentByIntentId.get(fill.intentId) ?? null;
    const canonicalStatus: CanonicalStatus = settlement ? "SETTLED" : "PENDING";

    return {
      intentId: fill.intentId as Hex,
      sourceChainId: sourceIntent
        ? Number(sourceIntent.sourceChainId)
        : (otherChainId(chainId) ?? chainId),
      destinationChainId: chainId,
      amountAdvanced: BigInt(fill.outputAmount),
      feeAmount: sourceIntent ? BigInt(sourceIntent.amount) - BigInt(fill.outputAmount) : 0n,
      fastFillTimestamp: Number(fill.timestamp),
      canonicalStatus,
      settlementLatencySeconds:
        settlement && sourceIntent
          ? Number(settlement.timestamp) - Number(sourceIntent.createdAtTimestamp)
          : null,
      // Falls back to the destination tx only in the rare case the source-chain
      // intent hasn't indexed yet — momentary lag, not a fabricated value; the
      // type has no null to express "not yet known" here.
      sourceTxHash: (sourceIntent?.createdTxHash ?? fill.txHash) as Hex,
      destinationTxHash: fill.txHash as Hex,
    };
  });
}

export function useVaultFills(chainId: number, vaultAddress: Address | null): DataState<FillRow[]> {
  const enabled = Boolean(vaultAddress && chainConfig(chainId)?.subgraphUrl);

  const query = useQuery({
    queryKey: ["vault-fills", chainId, vaultAddress],
    queryFn: () => fetchVaultFills(chainId),
    enabled,
    refetchInterval: 15_000,
  });

  if (!vaultAddress) return unavailableState("Select a vault");
  if (!chainConfig(chainId)?.subgraphUrl) return unavailableState("Indexer not connected");
  if (query.isError) {
    return errorState(query.error instanceof Error ? query.error.message : "Indexer query failed");
  }
  if (!query.data) return unavailableState("Indexer not connected");
  if (query.data.length === 0) return emptyState();
  return readyState(query.data);
}

export function useVaultActivity(
  chainId: number,
  vaultAddress: Address | null,
): DataState<ActivityRow[]> {
  if (!vaultAddress) return unavailableState("Select a vault");
  if (!chainConfig(chainId)?.subgraphUrl) return unavailableState("Indexer not connected");
  return unavailableState(
    "Not tracked in V1 — no on-chain trace exists for a lost race, reversion, policy rejection or expiry",
  );
}
