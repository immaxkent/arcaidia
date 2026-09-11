export { RelayStore, type RelayStoreOptions, type StageEventRejection } from './store.js';
export { buildChallengeMessage, verifyChallengeSignature, type ChallengeInput } from './pairing.js';
export {
  startHeartbeatSweeper,
  type HeartbeatSweeperHandle,
  type HeartbeatSweeperOptions,
} from './heartbeat-sweeper.js';
export { startRelayServer, type RelayServerHandle, type RelayServerOptions } from './server.js';
export {
  TELEMETRY_STAGES,
  initialState,
  vaultKeyOf,
  vaultKeyToken,
  type TelemetryStage,
  type VaultKey,
  type VaultTelemetryState,
} from './types.js';
