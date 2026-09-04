/**
 * The dual settlement state model (specification §9).
 *
 * Arcaidia has TWO independent settlement facts and they must never be merged:
 *
 *   - `fastStatus`      — has the recipient been paid from LP inventory?
 *   - `canonicalStatus` — has Circle CCTP delivered canonical USDC and has it
 *                         been reconciled?
 *
 * There is deliberately no `completed`, `done`, `finished` or `success` state in
 * this module. A single boolean would let the UI or an API tell a user that a
 * transfer is finished when the LP is still carrying an unreimbursed receivable,
 * or tell an LP their capital is back when it is not. The guard test in
 * `test/vocabulary.test.ts` fails the build if such a term is reintroduced.
 */

import type { Bytes32, UnixSeconds } from './primitives.js';

/** Has the recipient received LP-advanced funds on the destination chain? */
export const FastStatus = {
  /** No destination advance yet. The intent may still be fast-filled. */
  PENDING: 'PENDING',
  /** Recipient holds LP USDC. The LP now carries a receivable against CCTP. */
  FAST_FILLED: 'FAST_FILLED',
} as const;
export type FastStatus = (typeof FastStatus)[keyof typeof FastStatus];

/** Has canonical CCTP settlement arrived and been reconciled? */
export const CanonicalStatus = {
  /** Canonical settlement is in flight. Economic finality has not been reached. */
  PENDING: 'PENDING',
  /** Canonical USDC received on the destination chain and reconciled. */
  SETTLED: 'SETTLED',
} as const;
export type CanonicalStatus = (typeof CanonicalStatus)[keyof typeof CanonicalStatus];

/**
 * Where canonical funds went once they arrived. Only meaningful when
 * `canonicalStatus === SETTLED`; the two fast-status branches of specification
 * §11 map onto these two outcomes.
 */
export const CanonicalOutcome = {
  /** The intent was fast-filled, so canonical USDC replenishes LP inventory. */
  LP_REIMBURSED: 'LP_REIMBURSED',
  /** No solver fast-filled, so canonical USDC is delivered to the recipient. */
  RECIPIENT_FALLBACK: 'RECIPIENT_FALLBACK',
} as const;
export type CanonicalOutcome = (typeof CanonicalOutcome)[keyof typeof CanonicalOutcome];

/**
 * The composite settlement state of one intent: two axes, tracked separately,
 * each sourced from its own onchain evidence.
 */
export interface IntentSettlementState {
  readonly intentId: Bytes32;
  readonly fastStatus: FastStatus;
  readonly canonicalStatus: CanonicalStatus;
  /** Present only once `canonicalStatus` is SETTLED. */
  readonly canonicalOutcome?: CanonicalOutcome;
  /** When the fast fill confirmed onchain, if it did. */
  readonly fastFilledAt?: UnixSeconds;
  /** When canonical settlement was reconciled, if it has been. */
  readonly settledAt?: UnixSeconds;
}

/**
 * The 2×2 matrix from specification §9, as plain language. Used by the UI and by
 * decision logs so the meaning of a state is defined in exactly one place.
 */
export function describeSettlementState(state: {
  fastStatus: FastStatus;
  canonicalStatus: CanonicalStatus;
}): string {
  const { fastStatus, canonicalStatus } = state;
  if (fastStatus === FastStatus.PENDING && canonicalStatus === CanonicalStatus.PENDING) {
    return 'Intent committed; no destination advance yet.';
  }
  if (fastStatus === FastStatus.FAST_FILLED && canonicalStatus === CanonicalStatus.PENDING) {
    return 'Recipient has LP USDC; LP carries a receivable against CCTP.';
  }
  if (fastStatus === FastStatus.PENDING && canonicalStatus === CanonicalStatus.SETTLED) {
    return 'No fast fill; canonical funds routed to the recipient fallback.';
  }
  return 'Recipient was paid early and the LP has been replenished.';
}

/**
 * Has the *user* got their money? This is a question about the fast axis only.
 * It says nothing about whether the LP has been made whole.
 */
export function isRecipientPaid(state: IntentSettlementState): boolean {
  return (
    state.fastStatus === FastStatus.FAST_FILLED ||
    (state.canonicalStatus === CanonicalStatus.SETTLED &&
      state.canonicalOutcome === CanonicalOutcome.RECIPIENT_FALLBACK)
  );
}

/**
 * Has economic finality been reached — canonical settlement reconciled? This is
 * a question about the canonical axis only. It says nothing about whether the
 * user has been paid yet.
 */
export function isCanonicallyFinal(state: IntentSettlementState): boolean {
  return state.canonicalStatus === CanonicalStatus.SETTLED;
}

/**
 * Is LP capital still advanced and awaiting canonical reimbursement? This is the
 * exposure that the risk engine prices.
 */
export function isLpExposed(state: IntentSettlementState): boolean {
  return state.fastStatus === FastStatus.FAST_FILLED && state.canonicalStatus === CanonicalStatus.PENDING;
}
