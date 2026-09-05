/**
 * One settlement, advanced by one step.
 *
 * The worker is a loop around this function. Keeping a single step separately
 * callable is what makes the awkward cases testable: a step that is interrupted
 * and repeated, two processes stepping the same settlement at once, a step
 * taken against a chain that has already moved on.
 *
 * Three rules hold throughout:
 *
 *   - **The chain is asked first.** The journal is a queue, not a record of
 *     truth. A restarted worker with an empty journal must behave correctly,
 *     and a worker with a stale journal must not act on it.
 *   - **Every step is safe to repeat.** Completion is idempotent at the
 *     transport, settlement is idempotent at the receiver, and this function
 *     re-checks both rather than assuming its last attempt failed.
 *   - **Nothing is marked done until the chain says so.**
 */

import {
  SettlementStatus,
  type Address,
  type SettlementAdapter,
  type SettlementState,
  type UnixSeconds,
} from '@arcaidia/domain';

import type {
  SettlementJournal,
  SettlementReceiverClient,
  SettlementRecord,
} from './ports.js';

export interface SettlementDependencies {
  readonly adapter: SettlementAdapter;
  readonly receivers: ReadonlyMap<number, Address>;
  readonly receiverClient: SettlementReceiverClient;
  readonly journal: SettlementJournal;
  readonly clock: () => UnixSeconds;
}

export type SettlementStepOutcome =
  /** Attestation is not ready. Nothing to do but wait. */
  | { readonly kind: 'WAITING'; readonly status: SettlementStatus }
  /** Canonical funds routed. The intent is finished. */
  | {
      readonly kind: 'SETTLED';
      readonly outcome: 'LP_REIMBURSED' | 'RECIPIENT_FALLBACK';
      readonly txHash: `0x${string}`;
    }
  /** The chain had already settled this — another worker, or a previous run. */
  | { readonly kind: 'ALREADY_SETTLED' }
  /** The transport is unreachable. Recoverable; retry later. */
  | { readonly kind: 'TRANSPORT_UNAVAILABLE'; readonly error: Error }
  /** Something else went wrong. The settlement stays pending. */
  | { readonly kind: 'FAILED'; readonly error: Error };

export async function processSettlement(
  record: SettlementRecord,
  deps: SettlementDependencies,
): Promise<SettlementStepOutcome> {
  const { adapter, receivers, receiverClient, journal, clock } = deps;
  const { reference } = record;

  const receiver = receivers.get(reference.destinationChainId);
  if (!receiver) {
    return {
      kind: 'FAILED',
      error: new Error(`No settlement receiver configured for chain ${reference.destinationChainId}.`),
    };
  }

  // The chain first, always. A journal that says "pending" proves nothing.
  let alreadySettled: boolean;
  try {
    alreadySettled = await receiverClient.isSettled(
      reference.destinationChainId,
      receiver,
      reference.intentId,
    );
  } catch (error) {
    return { kind: 'FAILED', error: asError(error) };
  }

  if (alreadySettled) {
    // Reconcile the local view to the chain rather than the other way round.
    journal.markSettled(reference.intentId, clock());
    return { kind: 'ALREADY_SETTLED' };
  }

  let state: SettlementState;
  try {
    state = await adapter.status(reference);
  } catch (error) {
    return { kind: 'TRANSPORT_UNAVAILABLE', error: asError(error) };
  }

  if (state.status === SettlementStatus.FAILED) {
    return { kind: 'FAILED', error: new Error(state.failureReason ?? 'Settlement failed.') };
  }

  // Complete the destination leg if the attestation is ready and we have not
  // already done so. Repeating this is safe by the adapter's contract.
  if (state.status === SettlementStatus.ATTESTED) {
    try {
      state = await adapter.complete(reference);
    } catch (error) {
      return { kind: 'TRANSPORT_UNAVAILABLE', error: asError(error) };
    }
  }

  if (state.status !== SettlementStatus.RECEIVED && state.status !== SettlementStatus.RECONCILED) {
    return { kind: 'WAITING', status: state.status };
  }

  // Funds are on the destination chain. Route them.
  try {
    const report = await receiverClient.settle(
      reference.destinationChainId,
      receiver,
      reference.intentId,
      record.fallbackRecipient,
      record.amount,
    );

    journal.markSettled(reference.intentId, clock());
    return { kind: 'SETTLED', outcome: report.outcome, txHash: report.txHash };
  } catch (error) {
    // Deliberately not marked settled. If the transaction did in fact land, the
    // next run's onchain check catches it and reconciles; if it did not, the
    // next run retries. Marking it here would strand the intent on a failure
    // that never actually happened.
    return { kind: 'FAILED', error: asError(error) };
  }
}

/** One pass over everything the journal is tracking. */
export async function runSettlementPass(
  deps: SettlementDependencies,
): Promise<ReadonlyMap<string, SettlementStepOutcome>> {
  const results = new Map<string, SettlementStepOutcome>();

  for (const record of deps.journal.pending()) {
    results.set(record.reference.intentId, await processSettlement(record, deps));
  }

  return results;
}

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));
