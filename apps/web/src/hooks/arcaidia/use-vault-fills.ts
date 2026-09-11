/**
 * Realised fills (successful, winning) and non-realised activity for a vault.
 *
 * SOURCE (fills): Arcaidia's shared, unlimited indexer (WP-22/23) — SQL over
 * HTTP, two Nests joined by intentId, the same cross-chain join
 * `useIntentHistory` needs, run from the opposite direction. `fills`/
 * `settlements` are indexed on *this* vault's own chain (its own
 * `chainConfig(chainId).subgraphUrl`); the intent's origin details
 * (sourceChainId, sourceTxHash, principal amount) live on the *other*
 * chain's Nest, since that's where `IntentCreated` fired. V1 has exactly
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
import { queryNest, sqlHex32InClause } from "@/lib/arcaidia/nest";
import type { ActivityRow, Address, CanonicalStatus, FillRow, Hex } from "@/lib/arcaidia/types";

interface RawFill {
  id: string;
  intent_id: string;
  output_amount: string;
  timestamp: number;
  tx_hash: string;
}

interface RawSettlement {
  intent_id: string;
  outcome: string;
  amount: string;
  timestamp: number;
  tx_hash: string;
}

interface RawIntent {
  id: string;
  source_chain_id: string;
  amount: string;
  created_at_timestamp: number;
  created_tx_hash: string;
}

function otherChainId(chainId: number): number | null {
  return SUPPORTED_CHAIN_IDS.find((id) => id !== chainId) ?? null;
}

async function fetchVaultFills(chainId: number): Promise<FillRow[]> {
  const endpoint = chainConfig(chainId)?.subgraphUrl;
  if (!endpoint) throw new Error("Indexer not connected");

  const { rows: fills } = await queryNest<RawFill>(
    endpoint,
    "SELECT id, intent_id, output_amount, timestamp, tx_hash FROM fills ORDER BY timestamp DESC LIMIT 200",
  );
  if (fills.length === 0) return [];

  const ids = fills.map((fill) => fill.intent_id as Hex);
  const idsClause = sqlHex32InClause(ids);
  const sourceEndpoint = chainConfig(otherChainId(chainId) ?? -1)?.subgraphUrl;

  const [{ rows: settlements }, sourceIntents] = await Promise.all([
    queryNest<RawSettlement>(
      endpoint,
      `SELECT intent_id, outcome, amount, timestamp, tx_hash FROM settlements WHERE intent_id IN (${idsClause})`,
    ),
    sourceEndpoint
      ? queryNest<RawIntent>(
          sourceEndpoint,
          `SELECT id, source_chain_id, amount, created_at_timestamp, created_tx_hash FROM intents WHERE id IN (${idsClause})`,
        )
      : Promise.resolve({ rows: [] as RawIntent[], count: 0, truncated: false, degraded: false }),
  ]);

  const settlementByIntentId = new Map(settlements.map((s) => [s.intent_id, s]));
  const intentByIntentId = new Map(sourceIntents.rows.map((i) => [i.id, i]));

  return fills.map((fill): FillRow => {
    const settlement = settlementByIntentId.get(fill.intent_id) ?? null;
    const sourceIntent = intentByIntentId.get(fill.intent_id) ?? null;
    const canonicalStatus: CanonicalStatus = settlement ? "SETTLED" : "PENDING";

    return {
      intentId: fill.intent_id as Hex,
      sourceChainId: sourceIntent
        ? Number(sourceIntent.source_chain_id)
        : (otherChainId(chainId) ?? chainId),
      destinationChainId: chainId,
      amountAdvanced: BigInt(fill.output_amount),
      feeAmount: sourceIntent ? BigInt(sourceIntent.amount) - BigInt(fill.output_amount) : 0n,
      fastFillTimestamp: fill.timestamp,
      canonicalStatus,
      settlementLatencySeconds:
        settlement && sourceIntent ? settlement.timestamp - sourceIntent.created_at_timestamp : null,
      // Falls back to the destination tx only in the rare case the source-chain
      // intent hasn't indexed yet — momentary lag, not a fabricated value; the
      // type has no null to express "not yet known" here.
      sourceTxHash: (sourceIntent?.created_tx_hash ?? fill.tx_hash) as Hex,
      destinationTxHash: fill.tx_hash as Hex,
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
