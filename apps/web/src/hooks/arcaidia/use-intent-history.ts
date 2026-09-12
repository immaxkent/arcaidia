/**
 * The connected owner's intent history (status / history surface).
 *
 * SOURCE: Arcaidia's shared, unlimited indexer (WP-22/23) — SQL over HTTP,
 * both configured chains — with the chain's own events as the fallback when
 * the indexer is missing, behind, or mid-re-seed (`lib/arcaidia/chain-history`):
 * the router's `IntentCreated`, every factory vault's `FastFilled` and the
 * receiver's settlement events carry the same facts, read straight from the RPC.
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
import { fillsFromChain, intentsFromChain, settlementsFromChain } from "@/lib/arcaidia/chain-history";
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
  intent_version: number | string;
  token_out: string;
  target_min_out: string;
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

/**
 * The shared fetch+join both `useIntentHistory` (sender-scoped) and
 * `useAllTransfers` (unscoped) need — identical cross-chain fill/settlement
 * join, the only difference is whether the initial `intents` query carries
 * a `WHERE sender = ...` at all.
 */
async function fetchIntentRowsFromNest(
  chainIds: readonly number[],
  senderFilter: Address | null,
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

  const whereClause = senderFilter ? `WHERE sender = ${sqlHex20Literal(senderFilter)} ` : "";
  const perChain = await Promise.all(
    endpoints.map((source) =>
      queryNest<RawIntent>(
        source.subgraphUrl,
        "SELECT id, sender, recipient, input_token, amount, source_chain_id, destination_chain_id, " +
          `max_fee_bps, deadline, intent_version, token_out, target_min_out, created_at_timestamp, created_tx_hash FROM intents ` +
          `${whereClause}ORDER BY created_at_timestamp DESC LIMIT 200`,
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
      intentVersion: Number(raw.intent_version),
      tokenOut: raw.token_out as Address,
      targetMinOut: BigInt(raw.target_min_out),
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

/**
 * The same rows from the chain's own events. Intents come from each chain's router (sender is
 * indexed, so the filter runs in the RPC); each intent's fill and settlement live on its
 * destination chain — the vault's `FastFilled` and the receiver's outcome event.
 */
async function fetchIntentRowsFromChain(
  chainIds: readonly number[],
  senderFilter: Address | null,
): Promise<IntentHistoryRow[]> {
  const perChain = await Promise.all(chainIds.map((id) => intentsFromChain(id, { sender: senderFilter })));
  const intents = perChain
    .flat()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 200);
  if (intents.length === 0) return [];

  const idsByDestination = new Map<number, Hex[]>();
  for (const intent of intents) {
    const list = idsByDestination.get(intent.destinationChainId) ?? [];
    list.push(intent.intentId);
    idsByDestination.set(intent.destinationChainId, list);
  }

  const fillByIntentId = new Map<string, Awaited<ReturnType<typeof fillsFromChain>>[number]>();
  const settlementByIntentId = new Map<string, Awaited<ReturnType<typeof settlementsFromChain>>[number]>();
  await Promise.all(
    [...idsByDestination.entries()].map(async ([destinationChainId, ids]) => {
      const [fills, settlements] = await Promise.all([
        fillsFromChain(destinationChainId, { intentIds: ids }),
        settlementsFromChain(destinationChainId, ids),
      ]);
      for (const fill of fills) fillByIntentId.set(fill.intentId.toLowerCase(), fill);
      for (const settlement of settlements) settlementByIntentId.set(settlement.intentId.toLowerCase(), settlement);
    }),
  );

  return intents.map((chainIntent): IntentHistoryRow => {
    const { blockNumber: _block, ...intent } = chainIntent;
    const key = intent.intentId.toLowerCase();
    const fill = fillByIntentId.get(key) ?? null;
    const settlement = settlementByIntentId.get(key) ?? null;
    return {
      intent,
      settlement: {
        intentId: intent.intentId,
        fastStatus: fill ? "FAST_FILLED" : "PENDING",
        canonicalStatus: settlement ? "SETTLED" : "PENDING",
        ...(settlement ? { canonicalOutcome: settlement.outcome } : {}),
        ...(fill ? { fastFilledAt: fill.timestamp } : {}),
        ...(settlement ? { settledAt: settlement.timestamp } : {}),
      },
      winningVault: fill?.vault ?? null,
      feeCharged: fill?.feeAmount ?? null,
      destinationTxHash: fill?.txHash ?? null,
      settlementTxHash: settlement?.txHash ?? null,
      settlementLatencySeconds: settlement ? settlement.timestamp - intent.createdAt : null,
    };
  });
}

/** Indexer first (cheap, joined); the chain when the indexer cannot answer. */
export async function fetchIntentRows(
  chainIds: readonly number[],
  senderFilter: Address | null,
): Promise<IntentHistoryRow[]> {
  const indexed = chainIds.filter((id) => chainConfig(id)?.subgraphUrl);
  const onChain = chainIds.filter((id) => chainConfig(id)?.rpcUrl);
  if (indexed.length === chainIds.length) {
    try {
      return await fetchIntentRowsFromNest(chainIds, senderFilter);
    } catch (error) {
      // Fall through to the chain — unless there is no RPC to fall through to, in which
      // case the indexer's failure is the honest answer, never a silently empty history.
      if (onChain.length === 0) throw error;
    }
  }
  return fetchIntentRowsFromChain(onChain, senderFilter);
}

export function useIntentHistory(
  owner: Address | null,
  chainIds: readonly number[],
): DataState<IntentHistoryRow[]> {
  const readableChainIds = chainIds.filter((id) => chainConfig(id)?.subgraphUrl || chainConfig(id)?.rpcUrl);
  const enabled = Boolean(owner && readableChainIds.length > 0);

  const query = useQuery({
    queryKey: ["intent-history", owner, readableChainIds],
    queryFn: () => fetchIntentRows(readableChainIds, owner as Address),
    enabled,
    refetchInterval: 30_000,
  });

  if (!owner) return unavailableState("Connect wallet");
  if (readableChainIds.length === 0) return unavailableState("No indexer or RPC configured");
  if (query.isError) {
    return errorState(query.error instanceof Error ? query.error.message : "History read failed");
  }
  if (!query.data) return unavailableState("Loading history");
  if (query.data.length === 0) return emptyState();
  return readyState(query.data);
}

/**
 * Every transfer across the whole market — no sender filter — for a public,
 * view-only "all transfers" feed. Same join, same rules, deliberately no
 * concept of ownership: unlike `useIntentHistory`, a disconnected wallet is
 * not a reason to show `unavailable` here, since nothing about this view
 * ever depended on who's connected.
 */
export function useAllTransfers(chainIds: readonly number[]): DataState<IntentHistoryRow[]> {
  const readableChainIds = chainIds.filter((id) => chainConfig(id)?.subgraphUrl || chainConfig(id)?.rpcUrl);
  const enabled = readableChainIds.length > 0;

  const query = useQuery({
    queryKey: ["all-transfers", readableChainIds],
    queryFn: () => fetchIntentRows(readableChainIds, null),
    enabled,
    refetchInterval: 30_000,
  });

  if (readableChainIds.length === 0) return unavailableState("No indexer or RPC configured");
  if (query.isError) {
    return errorState(query.error instanceof Error ? query.error.message : "History read failed");
  }
  if (!query.data) return unavailableState("Loading history");
  if (query.data.length === 0) return emptyState();
  return readyState(query.data);
}
