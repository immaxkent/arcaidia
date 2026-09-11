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
export { FetchNestQueryClient, type NestQueryClient, type NestQueryResult } from './nest-client.js';
export { ParticipantRegistry } from './participant-registry.js';
export {
  extractJsonPayload,
  parseVaultFlowsCapture,
  FixtureParseError,
  FixtureVaultFlowSource,
} from './vault-flows/fixture-source.js';
export { filterForVault, filterKnownParticipants } from './vault-flows/filter.js';
export { VaultFlowsService } from './vault-flows/service.js';
export type { VaultFlowDeposit, VaultFlowEvent, VaultFlowSource, VaultFlowWithdraw } from './vault-flows/types.js';
