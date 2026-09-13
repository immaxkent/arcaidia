/**
 * Reimbursements a settlement receiver parked as HELD_FOR_VAULT for one vault — on the current
 * receiver (a vault that still pointed at a retired receiver when its fills settled, D12) or on
 * the retired receiver itself (settled there during the D12 window).
 *
 * SOURCE: the chain. The Nest only narrows the candidates: the retired receiver's holds come
 * from its `settlements` view; the current receiver's from this vault's own fills, each checked
 * with `outcomeOf`/`heldFor` on the receiver. A release already done shows as no longer held.
 */
import { useQuery } from "@tanstack/react-query";
import { ABIS } from "@arcaidia/domain";
import { chainConfig, RETIRED_SETTLEMENT_RECEIVER } from "@/lib/arcaidia/config";
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import { queryNest, sqlHex20Literal } from "@/lib/arcaidia/nest";
import type { Address, Hex } from "@/lib/arcaidia/types";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";

export interface HeldReimbursement {
  intentId: Hex;
  /** The receiver holding the USDC; `retryHeld` is called on this contract. */
  receiver: Address;
  /** True when the holder is a retired receiver: the vault must point at it while releasing (D12 sequence). */
  retired: boolean;
}

const HELD_FOR_VAULT = 3;

export async function fetchHeldReimbursements(chainId: number, vault: Address): Promise<HeldReimbursement[]> {
  const config = chainConfig(chainId);
  const client = publicClientFor(chainId);
  if (!config?.subgraphUrl || !client) return [];
  const current = config.settlementReceiver;
  const found: HeldReimbursement[] = [];
  const seen = new Set<string>();

  // Retired receiver: the Nest indexed those settlements.
  const retired = await queryNest<{ intent_id: string }>(
    config.subgraphUrl,
    `SELECT intent_id FROM settlements WHERE outcome = 'HELD_FOR_VAULT' AND held_for_vault = ${sqlHex20Literal(vault)}`,
  );
  for (const row of retired.rows) {
    const holder = (await client.readContract({ address: RETIRED_SETTLEMENT_RECEIVER, abi: ABIS.SettlementReceiver, functionName: "heldFor", args: [row.intent_id as Hex] })) as Address;
    if (holder.toLowerCase() === vault.toLowerCase() && !seen.has(row.intent_id.toLowerCase())) {
      seen.add(row.intent_id.toLowerCase());
      found.push({ intentId: row.intent_id as Hex, receiver: RETIRED_SETTLEMENT_RECEIVER, retired: true });
    }
  }

  // Current receiver: the Nest does not index it, so ask it about every fill this vault made.
  if (current) {
    const fills = await queryNest<{ intent_id: string }>(config.subgraphUrl, `SELECT intent_id FROM fills WHERE vault = ${sqlHex20Literal(vault)} ORDER BY timestamp DESC LIMIT 200`);
    const ids = fills.rows.map((r) => r.intent_id as Hex).filter((id) => !seen.has(id.toLowerCase()));
    if (ids.length > 0) {
      const outcomes = await client.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({ address: current, abi: ABIS.SettlementReceiver, functionName: "outcomeOf" as const, args: [id] as const })),
      });
      outcomes.forEach((o, i) => {
        if (o.status === "success" && Number(o.result) === HELD_FOR_VAULT) {
          found.push({ intentId: ids[i]!, receiver: current, retired: false });
        }
      });
    }
  }
  return found;
}

export function useHeldReimbursements(chainId: number, vault: Address | null): DataState<HeldReimbursement[]> {
  const enabled = Boolean(vault && chainConfig(chainId)?.rpcUrl);
  const query = useQuery({
    queryKey: ["held-reimbursements", chainId, vault],
    queryFn: () => fetchHeldReimbursements(chainId, vault as Address),
    enabled,
    refetchInterval: 45_000,
  });
  if (!vault) return unavailableState("Select a vault");
  if (query.isError) return errorState(query.error instanceof Error ? query.error.message : "Read failed");
  if (!query.data) return unavailableState("Loading");
  return readyState(query.data);
}
