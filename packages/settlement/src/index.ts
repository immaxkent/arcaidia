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

// Health, derived independently of the transport's own report
export { deriveSettlementHealth } from './health.js';
export type { HealthOptions } from './health.js';

// RPC adapter for the destination receiver
export { ViemSettlementReceiverClient } from './adapters/viem-receiver-client.js';
export type { ReceiverReadClient, ReceiverWriteClient } from './adapters/viem-receiver-client.js';
