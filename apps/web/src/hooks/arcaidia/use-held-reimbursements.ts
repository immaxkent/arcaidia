/**
 * D12: reimbursements the retired receiver parked as HELD_FOR_VAULT for one vault.
 *
 * SOURCE: the retired receiver's own `heldFor(intentId)` — the chain — for every intent the
 * Nest's `settlements` view lists as held for this vault. The Nest narrows the candidates; the
 * contract read is the fact (a release already done shows as no longer held).
 */
import { useQuery } from "@tanstack/react-query";
import { ABIS } from "@arcaidia/domain";
import { chainConfig, RETIRED_SETTLEMENT_RECEIVER } from "@/lib/arcaidia/config";
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import { queryNest, sqlHex20Literal } from "@/lib/arcaidia/nest";
import type { Address, Hex } from "@/lib/arcaidia/types";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";

export async function fetchHeldReimbursements(chainId: number, vault: Address): Promise<Hex[]> {
  const config = chainConfig(chainId);
  const client = publicClientFor(chainId);
  if (!config?.subgraphUrl || !client) return [];
  const { rows } = await queryNest<{ intent_id: string }>(
    config.subgraphUrl,
    `SELECT intent_id FROM settlements WHERE outcome = 'HELD_FOR_VAULT' AND held_for_vault = ${sqlHex20Literal(vault)}`,
  );
  const stillHeld = await Promise.all(
    rows.map(async (row) => {
      const holder = (await client.readContract({
        address: RETIRED_SETTLEMENT_RECEIVER,
        abi: ABIS.SettlementReceiver,
        functionName: "heldFor",
        args: [row.intent_id as Hex],
      })) as Address;
      return holder.toLowerCase() === vault.toLowerCase() ? (row.intent_id as Hex) : null;
    }),
  );
  return stillHeld.filter((id): id is Hex => id !== null);
}

export function useHeldReimbursements(chainId: number, vault: Address | null): DataState<Hex[]> {
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
