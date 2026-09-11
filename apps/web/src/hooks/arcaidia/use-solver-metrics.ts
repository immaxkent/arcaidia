/**
 * Solver Console summary metrics and honest solver status.
 *
 * WIRE (all real sources, no estimates):
 *   totalVolume        -> SUM(fills.output_amount) for this vault (Nest)
 *   totalFees          -> protocol_state.total_fees_earned (Nest — LP + protocol combined,
 *                         see use-vaults.ts's readVaultAggregates for the identical field)
 *   transactionCount   -> vault.fill_count (Nest)
 *   averageSettlement  -> left null: no single cheap aggregate exists for this (it needs a
 *                         cross-chain join, intent creation on the source chain against
 *                         settlement on the destination chain) — genuinely not wired, not
 *                         estimated. `useVaultFills` computes it per-row for callers that
 *                         already have that data loaded for a table.
 *   availableLiquidity -> direct SolverVault read
 *   outstandingExposure-> direct SolverVault read
 *   utilisationBps     -> calculation from the two above
 *   authState          -> direct SolverVault.isAuthorisedSigner(candidateOperator) read — never
 *                         inferred from telemetry pairing alone (WP-19.4). No candidate operator
 *                         known yet (nothing paired, nothing typed) means "not answerable", not
 *                         "unauthorised" — those are different facts.
 *   runtimeStatus      -> vault.paused (contract) takes priority; otherwise telemetry's own
 *                         `online` (WP-18.2's heartbeat-timeout sweep, not a local guess)
 *
 * Any field the sources cannot answer stays null so the UI renders `--`.
 */
import { useQuery } from "@tanstack/react-query";
import { solverVaultAbi } from "@/lib/arcaidia/abis";
import { chainConfig } from "@/lib/arcaidia/config";
import { errorState, readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import { queryNest, sqlHex20Literal } from "@/lib/arcaidia/nest";
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

async function fetchIndexedAggregates(
  chainId: number,
  vaultAddress: Address,
): Promise<{ totalVolume: bigint | null; totalFees: bigint | null; transactionCount: number | null }> {
  const endpoint = chainConfig(chainId)?.subgraphUrl;
  if (!endpoint) return { totalVolume: null, totalFees: null, transactionCount: null };

  try {
    const idLiteral = sqlHex20Literal(vaultAddress);
    const [volumeResult, vaultResult, protocolStateResult] = await Promise.all([
      queryNest<{ total_volume: string | null }>(
        endpoint,
        `SELECT SUM(output_amount) AS total_volume FROM fills WHERE vault = ${idLiteral}`,
      ),
      queryNest<{ fill_count: number }>(endpoint, `SELECT fill_count FROM vault WHERE id = ${idLiteral}`),
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
    // Indexer hiccup degrades these three fields only — never the RPC-sourced ones below.
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

  const [availableLiquidity, outstandingExposure, paused, isAuthorised, indexed] = await Promise.all([
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "availableLiquidity" }),
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "outstandingExposure" }),
    client.readContract({ address: vaultAddress, abi: solverVaultAbi, functionName: "paused" }),
    candidateOperator
      ? client.readContract({
          address: vaultAddress,
          abi: solverVaultAbi,
          functionName: "isAuthorisedSigner",
          args: [candidateOperator],
        })
      : Promise.resolve(null),
    fetchIndexedAggregates(chainId, vaultAddress),
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
    authState,
    // paused overrides even a live telemetry heartbeat — combined with that
    // heartbeat by the caller (see runtimeStatus below), not guessed here.
    runtimeStatus: paused ? "PAUSED" : null,
    authorisedSolver: isAuthorised ? candidateOperator : null,
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
    refetchInterval: 20_000,
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
