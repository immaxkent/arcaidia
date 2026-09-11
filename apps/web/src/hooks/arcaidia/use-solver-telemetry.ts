/**
 * Live solver telemetry feed (SSE), from the Telemetry Relay (WP-18) —
 * `GET {solverTelemetryUrl}/v1/telemetry/vault/{chainId}/{vaultAddress}/stream`.
 *
 * WIRE: SERVICES.solverTelemetryUrl.
 *
 * RULES
 *  - Telemetry only ever supplies PRE-CHAIN, informational stages:
 *    INTENT_DISCOVERED / VERIFYING_SOURCE / FORMULATING_FILL / SUBMITTING_SETTLEMENT.
 *  - Onchain-confirmed stages must come from RPC / contract / The Graph and always
 *    override telemetry once a transaction exists.
 *  - Telemetry pairing proves runtime identity. It is NOT solver authorisation.
 *  - With no heartbeat the orb is in standby: "SOLVER OFFLINE" / "AWAITING SOLVER".
 *    Never "SCANNING".
 *  - `chainId` is required, not optional: Arcaidia deploys through CREATE2 with
 *    identical salts, so the same vault address is expected to recur across
 *    chains (the House Vault already has the identical address on both
 *    Ethereum Sepolia and Arc Testnet) — keying this stream on address alone
 *    would silently merge two different vaults' telemetry (WP-18.4).
 */
import { useEffect, useState } from "react";
import { SERVICES } from "@/lib/arcaidia/config";
import { loadingState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address, SolverStageId } from "@/lib/arcaidia/types";

export type SolverTelemetryStage = Extract<
  SolverStageId,
  "INTENT_DISCOVERED" | "VERIFYING_SOURCE" | "FORMULATING_FILL" | "SUBMITTING_SETTLEMENT"
>;

const TELEMETRY_STAGES: readonly SolverTelemetryStage[] = [
  "INTENT_DISCOVERED",
  "VERIFYING_SOURCE",
  "FORMULATING_FILL",
  "SUBMITTING_SETTLEMENT",
];

export interface SolverTelemetry {
  /** Operator identity the runtime reports through signed pairing. */
  operatorAddress: Address | null;
  /** `TELEMETRY PAIRED` — proof of key possession only, never authorisation. */
  paired: boolean;
  /** False once the Relay's own heartbeat-timeout window has passed with nothing heard. */
  online: boolean;
  /** Unix seconds, or null if this vault has never sent a heartbeat at all (AWAITING SOLVER). */
  lastHeartbeatAt: number | null;
  /** Pre-chain stage only; null when the solver is idle. */
  stage: SolverTelemetryStage | null;
  stageAt: number | null;
  intentId: string | null;
}

/** The Relay's own `VaultTelemetryState` shape (`packages/relay/src/types.ts`), over the wire. */
interface RelayVaultTelemetryState {
  chainId: number;
  vaultAddress: string;
  operatorAddress: string | null;
  paired: boolean;
  online: boolean;
  lastHeartbeatAt: number | null;
  stage: string | null;
  stageAt: number | null;
  intentId: string | null;
}

function isTelemetryStage(value: string | null): value is SolverTelemetryStage {
  return value !== null && (TELEMETRY_STAGES as readonly string[]).includes(value);
}

/**
 * The Relay reports every field it knows about a vault, including onchain
 * vocabulary a future Relay version might add — narrowing here is what keeps
 * a stray non-pre-chain value from ever reaching the orb as a "stage",
 * independent of the Relay's own WP-18.3 validation on the write side.
 */
function toSolverTelemetry(raw: RelayVaultTelemetryState): SolverTelemetry {
  return {
    operatorAddress: (raw.operatorAddress as Address | null) ?? null,
    paired: raw.paired,
    online: raw.online,
    lastHeartbeatAt: raw.lastHeartbeatAt,
    stage: isTelemetryStage(raw.stage) ? raw.stage : null,
    stageAt: raw.stageAt,
    intentId: raw.intentId,
  };
}

function streamUrl(baseUrl: string, chainId: number, vaultAddress: Address): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/telemetry/vault/${chainId}/${vaultAddress}/stream`;
}

export function useSolverTelemetry(
  chainId: number,
  vaultAddress: Address | null,
): DataState<SolverTelemetry> {
  const relayUrl = SERVICES.solverTelemetryUrl;
  const [state, setState] = useState<DataState<SolverTelemetry>>(loadingState());

  useEffect(() => {
    if (!vaultAddress || !relayUrl) return;

    // A vault/chain switch must not keep showing the *previous* vault's last
    // known telemetry while the new stream connects.
    setState(loadingState());

    const source = new EventSource(streamUrl(relayUrl, chainId, vaultAddress));

    source.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string) as RelayVaultTelemetryState;
        setState({ status: "ready", data: toSolverTelemetry(raw) });
      } catch {
        // A malformed frame is not a reason to tear down a live connection —
        // the Relay pushes a full snapshot on every change, so the next
        // frame supersedes this one rather than needing to be recovered from.
      }
    };

    // EventSource retries the connection on its own; report unavailable for
    // as long as it's down rather than silently freezing the last-known
    // state as if it were still current.
    source.onerror = () => setState(unavailableState("Telemetry stream unreachable"));

    return () => source.close();
  }, [chainId, vaultAddress, relayUrl]);

  if (!vaultAddress) return unavailableState("Deploy vault first");
  if (!relayUrl) return unavailableState("Telemetry unavailable");
  return state;
}
