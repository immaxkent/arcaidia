/**
 * The real onchain outcome of one specific intent, on one specific chain —
 * the missing half of WP-19.3's console state machine.
 *
 * Telemetry (`useSolverTelemetry`) can only ever report that *this* vault's
 * own solver submitted something; it has no way to know whether that
 * fastFill actually landed, or whether a different vault won the race
 * first. Both are genuinely onchain facts, so both come from here — a
 * direct query against the Nest's `fills`/`settlements` tables for this
 * exact `intentId`, filtered by nothing else. `fills.vault` is what makes
 * "did *this* vault win, or a different one" answerable at all: a fill row
 * existing for this intentId with a *different* vault is exactly what
 * `LOST_RACE` means.
 *
 * Deliberately does not attempt to represent `AWAITING_CONFIRMATION` (a
 * submitted-but-not-yet-mined fastFill) — an indexer only ever reports
 * confirmed state, so that stage would have to come from watching a specific
 * tx hash over RPC, a different, real capability this hook doesn't have.
 * Telemetry's own `SUBMITTING_SETTLEMENT` already covers that window
 * honestly; this hook only ever asserts what the chain has actually
 * confirmed.
 */
import { useQuery } from "@tanstack/react-query";
import { chainConfig } from "@/lib/arcaidia/config";
import { readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import { queryNest, sqlHex32InClause } from "@/lib/arcaidia/nest";
import type { Address, CanonicalOutcome, Hex } from "@/lib/arcaidia/types";

export interface IntentOutcome {
  readonly filled: boolean;
  readonly winningVault: Address | null;
  readonly settled: boolean;
  readonly settlementOutcome: CanonicalOutcome | null;
}

interface RawFillRow {
  vault: string;
}

interface RawSettlementRow {
  outcome: string;
}

async function fetchIntentOutcome(chainId: number, intentId: Hex): Promise<IntentOutcome> {
  const endpoint = chainConfig(chainId)?.subgraphUrl;
  if (!endpoint) throw new Error("Indexer not connected");

  const idClause = sqlHex32InClause([intentId]);
  const [fillsResult, settlementsResult] = await Promise.all([
    queryNest<RawFillRow>(endpoint, `SELECT vault FROM fills WHERE intent_id IN (${idClause})`),
    queryNest<RawSettlementRow>(endpoint, `SELECT outcome FROM settlements WHERE intent_id IN (${idClause})`),
  ]);

  const fill = fillsResult.rows[0] ?? null;
  const settlement = settlementsResult.rows[0] ?? null;

  return {
    filled: fill !== null,
    winningVault: fill ? (fill.vault as Address) : null,
    settled: settlement !== null,
    settlementOutcome: settlement ? (settlement.outcome as CanonicalOutcome) : null,
  };
}

export function useIntentOutcome(
  chainId: number,
  intentId: string | null,
): DataState<IntentOutcome> {
  const endpoint = chainConfig(chainId)?.subgraphUrl;
  const enabled = Boolean(intentId && endpoint);

  const query = useQuery({
    queryKey: ["intent-outcome", chainId, intentId],
    queryFn: () => fetchIntentOutcome(chainId, intentId as Hex),
    enabled,
    // A tight interval matters here specifically: this is what lets the
    // console notice a race was lost or a fastFill confirmed within a few
    // seconds, not the 15-20s cadence the fills/history tables use.
    refetchInterval: 4_000,
  });

  if (!intentId) return unavailableState("No active intent");
  if (!endpoint) return unavailableState("Indexer not connected");
  if (query.isError) {
    return unavailableState(query.error instanceof Error ? query.error.message : "Indexer query failed");
  }
  if (!query.data) return unavailableState("Indexer not connected");
  return readyState(query.data);
}
