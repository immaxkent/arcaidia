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
