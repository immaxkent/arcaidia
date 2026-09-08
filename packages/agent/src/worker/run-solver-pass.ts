/**
 * One pass over everything currently pending.
 *
 * Mirrors `@arcaidia/settlement`'s `runSettlementPass`: discovery and
 * processing are split out from "keep doing this forever" (`solver-worker.ts`)
 * so the awkward cases — discovery unreachable, one intent's processing
 * throwing instead of returning a refusal, an empty pending list — are all
 * directly testable without a live chain or a running timer.
 *
 * `processIntent` itself only returns typed outcomes for the failures it
 * anticipates (UNVERIFIED, DECLINED, SUBMISSION_FAILED, ...); it can still
 * throw for the ones it doesn't (an RPC drops mid-call, a route the config
 * doesn't know). One intent's throw must not stop the rest of the pass from
 * running — that would turn a single bad intent into a denial of service for
 * every other one discovered in the same tick.
 */

import type { Intent } from '@arcaidia/domain';
import { processIntent, type ProcessOutcome, type SolverDependencies } from '../solver/process-intent.js';

/** `ProcessOutcome` plus the one failure mode `processIntent` doesn't type: it threw. */
export type SolverPassOutcome = ProcessOutcome | { readonly kind: 'ERROR'; readonly error: Error };

export type SolverPassResult =
  /** Discovery worked; each discovered intent got at least one outcome. */
  | { readonly kind: 'RAN'; readonly outcomes: ReadonlyMap<string, SolverPassOutcome> }
  /** `observation.pendingIntents()` itself failed — nothing was processed this tick. */
  | { readonly kind: 'DISCOVERY_FAILED'; readonly error: Error };

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

export async function runSolverPass(deps: SolverDependencies): Promise<SolverPassResult> {
  let intents: readonly Intent[];
  try {
    intents = await deps.observation.pendingIntents();
  } catch (error) {
    return { kind: 'DISCOVERY_FAILED', error: asError(error) };
  }

  const outcomes = new Map<string, SolverPassOutcome>();
  for (const intent of intents) {
    try {
      outcomes.set(intent.intentId, await processIntent(intent, deps));
    } catch (error) {
      outcomes.set(intent.intentId, { kind: 'ERROR', error: asError(error) });
    }
  }

  return { kind: 'RAN', outcomes };
}
