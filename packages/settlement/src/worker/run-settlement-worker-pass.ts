/**
 * One pass: discover new settlements, then advance everything the journal
 * already knows about.
 *
 * Mirrors `@arcaidia/agent`'s `runSolverPass` in shape and for the identical
 * reason: discovery and processing are split out from "keep doing this
 * forever" (`settlement-worker.ts`) so the awkward cases — discovery
 * unreachable, one record throwing instead of the typed outcomes
 * `processSettlement` anticipates — are directly testable without a live
 * chain or a running timer. `runSettlementPass` itself stays untouched by
 * this: it only ever advances what the journal already tracks, so this file's
 * only new responsibility is getting new work into the journal in the first
 * place.
 */

import type { SettlementReference } from '@arcaidia/domain';
import { runSettlementPass, type SettlementDependencies, type SettlementStepOutcome } from './process-settlement.js';
import type { SettlementRecord } from './ports.js';
import type { SettlementDiscoveryProvider } from '../observation/discover-settlements.js';

/**
 * What a real settlement transport needs beyond the `SettlementAdapter`
 * interface: telling it about a commitment discovery just found. Not part of
 * `SettlementAdapter` itself because registration is a discovery-time
 * concern, not something `processSettlement`'s status/complete logic ever
 * calls — `MockSettlementAdapter` and `CircleCCTPAdapter` both implement this
 * shape already.
 */
export interface Registrable {
  register(reference: SettlementReference, amount: bigint): void;
}

export interface SettlementWorkerDependencies extends SettlementDependencies {
  readonly discovery: SettlementDiscoveryProvider;
  readonly registrar: Registrable;
}

export type SettlementWorkerPassResult =
  /** Discovery worked. `newlyTracked` is how many records were not already in the journal. */
  | {
      readonly kind: 'RAN';
      readonly newlyTracked: number;
      readonly outcomes: ReadonlyMap<string, SettlementStepOutcome>;
    }
  /** `discovery.pendingSettlements()` itself failed — nothing was processed this tick. */
  | { readonly kind: 'DISCOVERY_FAILED'; readonly error: Error };

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

export async function runSettlementWorkerPass(
  deps: SettlementWorkerDependencies,
): Promise<SettlementWorkerPassResult> {
  let discovered: readonly SettlementRecord[];
  try {
    discovered = await deps.discovery.pendingSettlements();
  } catch (error) {
    return { kind: 'DISCOVERY_FAILED', error: asError(error) };
  }

  const known = new Set(deps.journal.all().map((record) => record.reference.intentId.toLowerCase()));
  let newlyTracked = 0;

  for (const record of discovered) {
    const key = record.reference.intentId.toLowerCase();
    if (known.has(key)) continue;

    deps.journal.add(record);
    deps.registrar.register(record.reference, record.amount);
    known.add(key);
    newlyTracked += 1;
  }

  const outcomes = await runSettlementPass(deps);
  return { kind: 'RAN', newlyTracked, outcomes };
}
