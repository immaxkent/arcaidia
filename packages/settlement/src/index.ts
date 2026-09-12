/**
 * @arcaidia/settlement — the canonical settlement half.
 *
 * Watches committed transfers through their attestation lifecycle, completes
 * the destination leg, and routes the arriving funds to whichever party is owed
 * them. No Circle-specific type crosses the adapter boundary, so WP-10 swaps
 * the transport without the worker changing.
 */

export { MockSettlementAdapter } from './adapters/mock-settlement-adapter.js';
export type { MockSettlementOptions } from './adapters/mock-settlement-adapter.js';

// The real transport (WP-10)
export { CircleCCTPAdapter } from './adapters/circle-cctp-adapter.js';
export type {
  CircleCCTPAdapterOptions,
  CctpReadClient,
  CctpWriteClient,
} from './adapters/circle-cctp-adapter.js';

// The worker
export { processSettlement, runSettlementPass } from './worker/process-settlement.js';
export type {
  SettlementDependencies,
  SettlementStepOutcome,
} from './worker/process-settlement.js';
export { InMemorySettlementJournal } from './worker/ports.js';
export type {
  SettlementRecord,
  SettlementJournal,
  SettlementReceiverClient,
  SettlementOutcomeReport,
} from './worker/ports.js';

// Discovery + the continuous loop, for a live process (WP-10)
export { runSettlementWorkerPass } from './worker/run-settlement-worker-pass.js';
export type {
  Registrable,
  SettlementWorkerDependencies,
  SettlementWorkerPassResult,
} from './worker/run-settlement-worker-pass.js';
export { startSettlementWorker } from './worker/settlement-worker.js';
export type { SettlementWorkerOptions, SettlementWorkerHandle } from './worker/settlement-worker.js';
export { GraphSettlementDiscovery, NestSettlementDiscovery } from './observation/discover-settlements.js';
export type {
  SettlementChainSource,
  GraphSettlementDiscoveryOptions,
  NestSettlementDiscoveryOptions,
  SettlementDiscoveryProvider,
} from './observation/discover-settlements.js';
export { FetchGraphQueryClient } from './observation/graph-client.js';
export type { GraphQueryClient } from './observation/graph-client.js';
export { FetchNestQueryClient } from './observation/nest-client.js';
export type { NestQueryClient, NestQueryResult } from './observation/nest-client.js';

// Health, derived independently of the transport's own report
export { deriveSettlementHealth } from './health.js';
export type { HealthOptions } from './health.js';

// RPC adapter for the destination receiver
export { ViemSettlementReceiverClient } from './adapters/viem-receiver-client.js';
export type { ReceiverReadClient, ReceiverWriteClient } from './adapters/viem-receiver-client.js';
