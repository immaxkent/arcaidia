import type { TelemetryStage } from '@arcaidia/telemetry';

export type { TelemetryStage };
export { TELEMETRY_STAGES } from '@arcaidia/telemetry';

/**
 * A vault is identified by `{chainId, vaultAddress}`, never address alone.
 *
 * Arcaidia deploys through CREATE2 with identical salts, so the same vault
 * address recurring across chains is the expected case, not an edge one —
 * the committed House Vault already has the identical address on both
 * Ethereum Sepolia and Arc Testnet today (see
 * `packages/domain/src/config/deployments.ts`). A Relay keyed on address
 * alone would silently merge two different vaults' telemetry the moment two
 * chains are live, which is now.
 */
export interface VaultKey {
  readonly chainId: number;
  readonly vaultAddress: `0x${string}`;
}

/**
 * The full state the frontend needs for one vault's orb
 * (`apps/web/src/hooks/arcaidia/use-solver-telemetry.ts`'s `SolverTelemetry`
 * shape) — pushed as a whole snapshot on every change, never a diff, so a
 * client that just opened the SSE stream sees the same picture one that has
 * been connected the whole time does.
 */
export interface VaultTelemetryState extends VaultKey {
  readonly operatorAddress: `0x${string}` | null;
  /** `TELEMETRY PAIRED` — proof of key possession only, never execution rights. */
  readonly paired: boolean;
  /** False once `heartbeatTimeoutSeconds` has passed with nothing heard. */
  readonly online: boolean;
  readonly lastHeartbeatAt: number | null;
  readonly stage: TelemetryStage | null;
  readonly stageAt: number | null;
  readonly intentId: `0x${string}` | null;
}

export function initialState(key: VaultKey): VaultTelemetryState {
  return {
    chainId: key.chainId,
    vaultAddress: key.vaultAddress.toLowerCase() as `0x${string}`,
    operatorAddress: null,
    paired: false,
    online: false,
    lastHeartbeatAt: null,
    stage: null,
    stageAt: null,
    intentId: null,
  };
}

export function vaultKeyOf(chainId: number, vaultAddress: string): VaultKey {
  return { chainId, vaultAddress: vaultAddress.toLowerCase() as `0x${string}` };
}

export function vaultKeyToken(key: VaultKey): string {
  return `${key.chainId}:${key.vaultAddress.toLowerCase()}`;
}
