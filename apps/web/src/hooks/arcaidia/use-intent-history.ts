/**
 * The connected owner's intent history (status / history surface).
 *
 * SOURCE: The Graph, both configured chains.
 *
 * Two separate joins, for the same reason the backend's own
 * `GraphObservationProvider` and the subgraph mappings themselves document:
 * an intent's `Fill`/`Settlement` are indexed on the *destination* chain's
 * deployment, which never saw that intent's own `IntentCreated` event, so
 * `Intent.fill`/`Intent.settlement` never actually populate in this
 * architecture — see subgraph/src/vault.ts and subgraph/src/settlement.ts's
 * own "best-effort local join" comments. The real join happens here:
 *   1. query intents where sender = owner, on every configured chain
 *   2. group the results by destinationChainId
 *   3. query fills + settlements for those intentIds, on each destination
 *      chain's own subgraph
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
import { querySubgraph } from "@/lib/arcaidia/subgraph";
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

const INTENTS_BY_SENDER = `
  query IntentsBySender($sender: Bytes!) {
    intents(where: { sender: $sender }, orderBy: createdAtTimestamp, orderDirection: desc, first: 200) {
      id sender recipient inputToken amount sourceChainId destinationChainId
      maxFeeBps deadline createdAtTimestamp createdTxHash
    }
  }`;

const FILLS_AND_SETTLEMENTS_FOR_INTENTS = `
  query FillsAndSettlementsForIntents($ids: [Bytes!]!) {
    fills(where: { intentId_in: $ids }) { id intentId outputAmount timestamp txHash }
    settlements(where: { intentId_in: $ids }) { id intentId outcome amount timestamp txHash }
  }`;

interface RawIntent {
  id: string;
  sender: string;
  recipient: string;
  inputToken: string;
  amount: string;
  sourceChainId: string;
  destinationChainId: string;
  maxFeeBps: number;
  deadline: string;
  createdAtTimestamp: string;
  createdTxHash: string;
}

interface RawFill {
  id: string;
  intentId: string;
  outputAmount: string;
  timestamp: string;
  txHash: string;
}

interface RawSettlement {
  id: string;
  intentId: string;
  outcome: string;
  amount: string;
  timestamp: string;
  txHash: string;
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

  const perChain = await Promise.all(
    endpoints.map((source) =>
      querySubgraph<{ intents: RawIntent[] }>(source.subgraphUrl, INTENTS_BY_SENDER, {
        sender: owner.toLowerCase(),
      }),
    ),
  );
  const rawIntents = perChain.flatMap((data) => data.intents);
  if (rawIntents.length === 0) return [];

  // Group by destination chain — that is where each intent's Fill/Settlement live.
  const idsByDestination = new Map<number, string[]>();
  for (const intent of rawIntents) {
    const destinationChainId = Number(intent.destinationChainId);
    const list = idsByDestination.get(destinationChainId) ?? [];
    list.push(intent.id);
    idsByDestination.set(destinationChainId, list);
  }

  const destinationResults = await Promise.all(
    [...idsByDestination.entries()].map(async ([destinationChainId, ids]) => {
      const endpoint = chainConfig(destinationChainId)?.subgraphUrl;
      if (!endpoint)
        return { destinationChainId, fills: [] as RawFill[], settlements: [] as RawSettlement[] };
      const data = await querySubgraph<{ fills: RawFill[]; settlements: RawSettlement[] }>(
        endpoint,
        FILLS_AND_SETTLEMENTS_FOR_INTENTS,
        { ids },
      );
      return { destinationChainId, fills: data.fills, settlements: data.settlements };
    }),
  );

  const fillByIntentId = new Map<string, RawFill>();
  const settlementByIntentId = new Map<string, RawSettlement>();
  const houseVaultByChain = new Map(endpoints.map((e) => [e.id, e.houseVault]));
  for (const result of destinationResults) {
    for (const fill of result.fills) fillByIntentId.set(fill.intentId, fill);
    for (const settlement of result.settlements)
      settlementByIntentId.set(settlement.intentId, settlement);
  }

  return rawIntents.map((raw): IntentHistoryRow => {
    const fill = fillByIntentId.get(raw.id) ?? null;
    const settlement = settlementByIntentId.get(raw.id) ?? null;
    const destinationChainId = Number(raw.destinationChainId);
    const createdAt = Number(raw.createdAtTimestamp);

    const intent: Intent = {
      intentId: raw.id as Hex,
      sender: raw.sender as Address,
      recipient: raw.recipient as Address,
      inputToken: raw.inputToken as Address,
      amount: BigInt(raw.amount),
      sourceChainId: Number(raw.sourceChainId),
      destinationChainId,
      maxFeeBps: raw.maxFeeBps,
      deadline: Number(raw.deadline),
      createdAt,
      sourceTxHash: raw.createdTxHash as Hex,
    };

    return {
      intent,
      settlement: {
        intentId: raw.id as Hex,
        fastStatus: fill ? "FAST_FILLED" : "PENDING",
        canonicalStatus: settlement ? "SETTLED" : "PENDING",
        ...(settlement ? { canonicalOutcome: settlement.outcome as CanonicalOutcome } : {}),
        ...(fill ? { fastFilledAt: Number(fill.timestamp) } : {}),
        ...(settlement ? { settledAt: Number(settlement.timestamp) } : {}),
      },
      winningVault: fill ? (houseVaultByChain.get(destinationChainId) ?? null) : null,
      feeCharged: fill ? intent.amount - BigInt(fill.outputAmount) : null,
      destinationTxHash: fill?.txHash ?? null,
      settlementTxHash: settlement?.txHash ?? null,
      settlementLatencySeconds: settlement ? Number(settlement.timestamp) - createdAt : null,
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
