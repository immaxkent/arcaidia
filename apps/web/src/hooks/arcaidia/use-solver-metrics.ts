/**
 * Solver Console summary metrics and honest solver status.
 *
 * WIRE (all real sources, no estimates):
 *   totalVolume        -> SUM(fills.output_amount) for this vault (Nest), else the sum of the
 *                         vault's own `FastFilled.outputAmount` events read from the chain
 *   totalFees          -> protocol_state.total_fees_earned (Nest — LP + protocol combined,
 *                         see use-vaults.ts's readVaultAggregates for the identical field),
 *                         else the sum of `FastFilled.feeAmount` from the chain
 *   transactionCount   -> vault.fill_count (Nest), else the count of `FastFilled` events
 *   averageSettlement  -> left null: no single cheap aggregate exists for this (it needs a
 *                         cross-chain join, intent creation on the source chain against
 *                         settlement on the destination chain) — genuinely not wired, not
 *                         estimated. `useVaultFills` computes it per-row for callers that
 *                         already have that data loaded for a table.
 *   availableLiquidity -> direct SolverVault read
 *   outstandingExposure-> direct SolverVault read
 *   utilisationBps     -> calculation from the two above
 *   authState          -> direct SolverVault.isAuthorisedSigner(candidateOperator) read — never
 *                         inferred from telemetry pairing alone (WP-19.4). With no candidate
 *                         (nothing paired, nothing typed) the vault's own `AuthorisedSignerSet`
 *                         history supplies the most recently granted signer to check; a vault
 *                         that never granted one is "not answerable", not "unauthorised".
 *   runtimeStatus      -> vault.paused (contract) takes priority; otherwise telemetry's own
 *                         `online` (WP-18.2's heartbeat-timeout sweep, not a local guess)
 *
 * Any field the sources cannot answer stays null so the UI renders `--`.
 */
import { useQuery } from "@tanstack/react-query";
import { solverVaultAbi } from "@/lib/arcaidia/abis";
import { chainConfig } from "@/lib/arcaidia/config";
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import { authorisedSignersFromChain, fillsFromChain } from "@/lib/arcaidia/chain-history";
import { queryNest, queryVaultRow, sqlHex20Literal } from "@/lib/arcaidia/nest";
import type { Address, SolverAuthState, SolverRuntimeStatus } from "@/lib/arcaidia/types";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";

export interface SolverMetrics {
  totalVolume: bigint | null;
  totalFees: bigint | null;
  transactionCount: number | null;
  averageSettlementSeconds: number | null;
  availableLiquidity: bigint | null;
  outstandingExposure: bigint | null;
  utilisationBps: number | null;
  authState: SolverAuthState | null;
  /** The vault's posted fee tier right now (`currentFeeBps()`), null on a pre-v2 vault. */
  currentFeeBps: number | null;
  runtimeStatus: SolverRuntimeStatus | null;
  authorisedSolver: Address | null;
}

/** What the caller already knows and this hook should never re-derive independently. */
export interface SolverMetricsInputs {
  /** The operator address to check authorisation for — typed by the owner, or telemetry's own pairing report. Checking it is what WP-19.4 requires; *where it came from* is deliberately not this hook's concern. */
  readonly candidateOperator: Address | null;
  /** Telemetry's own heartbeat-timeout-derived liveness (WP-18.2) — never re-guessed with a second timeout constant here. */
  readonly telemetryOnline: boolean | null;
}

function utilisationBps(available: bigint, exposure: bigint): number | null {
  const total = available + exposure;
  if (total === 0n) return 0;
  return Number((exposure * 10_000n) / total);
}

interface Aggregates {
  totalVolume: bigint | null;
  totalFees: bigint | null;
  transactionCount: number | null;
}

async function fetchIndexedAggregates(chainId: number, vaultAddress: Address): Promise<Aggregates | null> {
  const endpoint = chainConfig(chainId)?.subgraphUrl;
  if (!endpoint) return null;

  try {
    const idLiteral = sqlHex20Literal(vaultAddress);
    const [volumeResult, vaultResult, protocolStateResult] = await Promise.all([
      queryNest<{ total_volume: string | null }>(
        endpoint,
        `SELECT SUM(output_amount) AS total_volume FROM fills WHERE vault = ${idLiteral}`,
      ),
      queryVaultRow<{ fill_count: number }>(endpoint, "fill_count", idLiteral),
      queryNest<{ total_fees_earned: string }>(
        endpoint,
        "SELECT total_fees_earned FROM protocol_state WHERE id = 'arcaidia'",
      ),
    ]);

    const totalVolumeRow = volumeResult.rows[0];
    return {
      totalVolume: totalVolumeRow?.total_volume != null ? BigInt(totalVolumeRow.total_volume) : null,
      totalFees: protocolStateResult.rows[0] ? BigInt(protocolStateResult.rows[0].total_fees_earned) : null,
      transactionCount: vaultResult.rows[0] ? Number(vaultResult.rows[0].fill_count) : null,
    };
  } catch {
    // Indexer missing, behind, or mid-re-seed: the chain's own `FastFilled` events answer instead.
    return null;
  }
}

/** The same three figures from the vault's own `FastFilled` events — the indexer-free path. */
async function fetchChainAggregates(chainId: number, vaultAddress: Address): Promise<Aggregates> {
  const fills = await fillsFromChain(chainId, { vaults: [vaultAddress] });
  return {
    totalVolume: fills.reduce((sum, f) => sum + f.outputAmount, 0n),
    totalFees: fills.reduce((sum, f) => sum + f.feeAmount, 0n),
    transactionCount: fills.length,
  };
}

async function fetchAggregates(chainId: number, vaultAddress: Address): Promise<Aggregates> {
  const indexed = await fetchIndexedAggregates(chainId, vaultAddress);
  // An indexer that answers but has no row for this vault (a pre-re-seed Nest, or one that
  // has not caught up to a vault created moments ago) is not a source for it — the chain is.
  if (indexed && indexed.transactionCount !== null) return indexed;
  try {
    return await fetchChainAggregates(chainId, vaultAddress);
  } catch {
    return { totalVolume: null, totalFees: null, transactionCount: null };
  }
}

async function fetchSolverMetrics(
  chainId: number,
  vaultAddress: Address,
  candidateOperator: Address | null,
): Promise<SolverMetrics> {
  const client = publicClientFor(chainId);
  if (!client) throw new Error("RPC not configured");

  // Nobody told us which operator to check (nothing typed, nothing paired): the vault's own
  // `AuthorisedSignerSet` history names the most recently granted signer. Still only a
  // *candidate* — the `isAuthorisedSigner` read below is the fact.
  const operator =
    candidateOperator ?? (await authorisedSignersFromChain(chainId, vaultAddress).catch(() => [] as Address[]))[0] ?? null;

  const [availableLiquidity, outstandingExposure, paused, rawFeeBps, isAuthorised, indexed] = await Promise.all([
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "availableLiquidity" }),
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "outstandingExposure" }),
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "paused" }),
    // v2 posted tier (D7); a pre-v2 vault has no such function — null, never a guess.
    (client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "currentFeeBps" }) as Promise<number>).catch(() => null),
    operator
      ? client.readContract({
          address: vaultAddress,
          abi: solverVaultAbi,
          functionName: "isAuthorisedSigner",
          args: [operator],
        })
      : Promise.resolve(null),
    fetchAggregates(chainId, vaultAddress),
  ]);

  const authState: SolverAuthState | null =
    isAuthorised === null ? null : isAuthorised ? "AUTHORISED" : "UNAUTHORISED";

  return {
    totalVolume: indexed.totalVolume,
    totalFees: indexed.totalFees,
    transactionCount: indexed.transactionCount,
    averageSettlementSeconds: null,
    availableLiquidity,
    outstandingExposure,
    utilisationBps: utilisationBps(availableLiquidity, outstandingExposure),
    currentFeeBps: rawFeeBps === null || Number.isNaN(Number(rawFeeBps)) ? null : Number(rawFeeBps),
    authState,
    // paused overrides even a live telemetry heartbeat — combined with that
    // heartbeat by the caller (see runtimeStatus below), not guessed here.
    runtimeStatus: paused ? "PAUSED" : null,
    authorisedSolver: isAuthorised ? operator : null,
  };
}

export function useSolverMetrics(
  chainId: number,
  vaultAddress: Address | null,
  inputs: SolverMetricsInputs = { candidateOperator: null, telemetryOnline: null },
): DataState<SolverMetrics> {
  const rpcUrl = chainConfig(chainId)?.rpcUrl;
  const enabled = Boolean(vaultAddress && rpcUrl);

  const query = useQuery({
    queryKey: ["solver-metrics", chainId, vaultAddress, inputs.candidateOperator],
    queryFn: () => fetchSolverMetrics(chainId, vaultAddress as Address, inputs.candidateOperator),
    enabled,
    refetchInterval: 30_000,
  });

  if (!vaultAddress) return unavailableState("Deploy vault first");
  if (!rpcUrl) return unavailableState("RPC not configured");
  if (query.isError) {
    return errorState(query.error instanceof Error ? query.error.message : "Read failed");
  }
  if (!query.data) return unavailableState("Solver metrics not connected");

  // runtimeStatus: the contract's own `paused` takes priority over anything
  // telemetry reports; otherwise defer to telemetry's own online/offline —
  // never re-derived from a second, locally-guessed timeout.
  const runtimeStatus: SolverRuntimeStatus | null =
    query.data.runtimeStatus === "PAUSED"
      ? "PAUSED"
      : inputs.telemetryOnline === null
        ? null
        : inputs.telemetryOnline
          ? "ONLINE"
          : "OFFLINE";

  return readyState({ ...query.data, runtimeStatus });
}
