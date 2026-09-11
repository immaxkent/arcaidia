/**
 * The connected owner's intent history (status / history surface).
 *
 * SOURCE: Arcaidia's shared, unlimited indexer (WP-22/23) — SQL over HTTP,
 * both configured chains.
 *
 * Two separate joins, for the same reason the backend's own
 * `SqlNestObservationProvider`/`GraphObservationProvider` document: an
 * intent's fill/settlement are indexed on the *destination* chain's
 * deployment, which never saw that intent's own `IntentCreated` event. The
 * real join happens here:
 *   1. query intents where sender = owner, on every configured chain
 *   2. group the results by destinationChainId
 *   3. query fills + settlements for those intentIds, on each destination
 *      chain's own Nest
 *   4. merge on intentId
 *
 * `winningVault` is honestly answerable in V1 without an extra query: V1 has
 * exactly one vault per chain (the House Vault), so any fill on a chain came
 * from that chain's houseVault by construction.
 *
 * Returns `empty` only when the indexer answers with zero rows. No example rows.
 */
import { useQuery } from "@tanstack/react-query";
import { chainConfig } from "@/lib/arcaidia/config";
import {
  emptyState,
  errorState,
  readyState,
  unavailableState,
  type DataState,
} from "@/lib/arcaidia/data-state";
import { queryNest, sqlHex20Literal, sqlHex32InClause } from "@/lib/arcaidia/nest";
import type {
  Address,
  CanonicalOutcome,
  Hex,
  Intent,
  IntentSettlementState,
} from "@/lib/arcaidia/types";

export interface IntentHistoryRow {
  intent: Intent;
  settlement: IntentSettlementState;
  winningVault: Address | null;
  feeCharged: bigint | null;
  destinationTxHash: string | null;
  settlementTxHash: string | null;
  settlementLatencySeconds: number | null;
}

interface RawIntent {
  id: string;
  sender: string;
  recipient: string;
  input_token: string;
  amount: string;
  source_chain_id: string;
  destination_chain_id: string;
  max_fee_bps: number;
  deadline: string;
  created_at_timestamp: number;
  created_tx_hash: string;
}

interface RawFill {
  id: string;
  intent_id: string;
  output_amount: string;
  timestamp: number;
  tx_hash: string;
}

interface RawSettlement {
  id: string;
  intent_id: string;
  outcome: string;
  amount: string;
  timestamp: number;
  tx_hash: string;
}

async function fetchIntentHistory(
  owner: Address,
  chainIds: readonly number[],
): Promise<IntentHistoryRow[]> {
  const endpoints = chainIds
    .map((id) => ({
      id,
      subgraphUrl: chainConfig(id)?.subgraphUrl ?? null,
      houseVault: chainConfig(id)?.houseVault ?? null,
    }))
    .filter(
      (c): c is { id: number; subgraphUrl: string; houseVault: Address | null } =>
        c.subgraphUrl !== null,
    );

  const senderLiteral = sqlHex20Literal(owner);
  const perChain = await Promise.all(
    endpoints.map((source) =>
      queryNest<RawIntent>(
        source.subgraphUrl,
        "SELECT id, sender, recipient, input_token, amount, source_chain_id, destination_chain_id, " +
          `max_fee_bps, deadline, created_at_timestamp, created_tx_hash FROM intents ` +
          `WHERE sender = ${senderLiteral} ORDER BY created_at_timestamp DESC LIMIT 200`,
      ),
    ),
  );
  const rawIntents = perChain.flatMap((data) => data.rows);
  if (rawIntents.length === 0) return [];

  // Group by destination chain — that is where each intent's fill/settlement live.
  const idsByDestination = new Map<number, Hex[]>();
  for (const intent of rawIntents) {
    const destinationChainId = Number(intent.destination_chain_id);
    const list = idsByDestination.get(destinationChainId) ?? [];
    list.push(intent.id as Hex);
    idsByDestination.set(destinationChainId, list);
  }

  const destinationResults = await Promise.all(
    [...idsByDestination.entries()].map(async ([destinationChainId, ids]) => {
      const endpoint = chainConfig(destinationChainId)?.subgraphUrl;
      if (!endpoint)
        return { destinationChainId, fills: [] as RawFill[], settlements: [] as RawSettlement[] };
      const idsClause = sqlHex32InClause(ids);
      const [fillsResult, settlementsResult] = await Promise.all([
        queryNest<RawFill>(
          endpoint,
          `SELECT id, intent_id, output_amount, timestamp, tx_hash FROM fills WHERE intent_id IN (${idsClause})`,
        ),
        queryNest<RawSettlement>(
          endpoint,
          `SELECT id, intent_id, outcome, amount, timestamp, tx_hash FROM settlements WHERE intent_id IN (${idsClause})`,
        ),
      ]);
      return { destinationChainId, fills: fillsResult.rows, settlements: settlementsResult.rows };
    }),
  );

  const fillByIntentId = new Map<string, RawFill>();
  const settlementByIntentId = new Map<string, RawSettlement>();
  const houseVaultByChain = new Map(endpoints.map((e) => [e.id, e.houseVault]));
  for (const result of destinationResults) {
    for (const fill of result.fills) fillByIntentId.set(fill.intent_id, fill);
    for (const settlement of result.settlements)
      settlementByIntentId.set(settlement.intent_id, settlement);
  }

  return rawIntents.map((raw): IntentHistoryRow => {
    const fill = fillByIntentId.get(raw.id) ?? null;
    const settlement = settlementByIntentId.get(raw.id) ?? null;
    const destinationChainId = Number(raw.destination_chain_id);
    const createdAt = raw.created_at_timestamp;

    const intent: Intent = {
      intentId: raw.id as Hex,
      sender: raw.sender as Address,
      recipient: raw.recipient as Address,
      inputToken: raw.input_token as Address,
      amount: BigInt(raw.amount),
      sourceChainId: Number(raw.source_chain_id),
      destinationChainId,
      maxFeeBps: raw.max_fee_bps,
      deadline: Number(raw.deadline),
      createdAt,
      sourceTxHash: raw.created_tx_hash as Hex,
    };

    return {
      intent,
      settlement: {
        intentId: raw.id as Hex,
        fastStatus: fill ? "FAST_FILLED" : "PENDING",
        canonicalStatus: settlement ? "SETTLED" : "PENDING",
        ...(settlement ? { canonicalOutcome: settlement.outcome as CanonicalOutcome } : {}),
        ...(fill ? { fastFilledAt: fill.timestamp } : {}),
        ...(settlement ? { settledAt: settlement.timestamp } : {}),
      },
      winningVault: fill ? (houseVaultByChain.get(destinationChainId) ?? null) : null,
      feeCharged: fill ? intent.amount - BigInt(fill.output_amount) : null,
      destinationTxHash: fill?.tx_hash ?? null,
      settlementTxHash: settlement?.tx_hash ?? null,
      settlementLatencySeconds: settlement ? settlement.timestamp - createdAt : null,
    };
  });
}

export function useIntentHistory(
  owner: Address | null,
  chainIds: readonly number[],
): DataState<IntentHistoryRow[]> {
  const indexedChainIds = chainIds.filter((id) => chainConfig(id)?.subgraphUrl);
  const enabled = Boolean(owner && indexedChainIds.length > 0);

  const query = useQuery({
    queryKey: ["intent-history", owner, indexedChainIds],
    queryFn: () => fetchIntentHistory(owner as Address, indexedChainIds),
    enabled,
    refetchInterval: 20_000,
  });

  if (!owner) return unavailableState("Connect wallet");
  if (indexedChainIds.length === 0) return unavailableState("Indexer not connected");
  if (query.isError) {
    return errorState(query.error instanceof Error ? query.error.message : "Indexer query failed");
  }
  if (!query.data) return unavailableState("Indexer not connected");
  if (query.data.length === 0) return emptyState();
  return readyState(query.data);
}
