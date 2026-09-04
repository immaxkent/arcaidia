/**
 * Independent verification of the source commitment.
 *
 * Pure: it takes evidence rather than fetching it, so every rejection branch is
 * reachable in a unit test. The impure half is the `SourceChainReader` that
 * produced the evidence.
 *
 * The order of checks runs from "are we even looking at the right thing" to
 * "does it say what we were told" to "is it settled enough to act on". A
 * mismatch anywhere is a refusal, never a warning: this is the last check
 * standing between a compromised indexer and the LP vault.
 */

import { ErrorCode, type Intent, type UnixSeconds } from '@arcaidia/domain';
import type { SourceEvidence } from './source-evidence.js';

export type VerificationResult =
  | { readonly ok: true; readonly confirmations: number }
  | { readonly ok: false; readonly code: ErrorCode; readonly detail: string };

export interface VerificationContext {
  readonly now: UnixSeconds;
  /** The router address configured for the source chain. */
  readonly expectedRouter: string;
  /** The settlement asset configured for the source chain. */
  readonly expectedAsset: string;
  /** Chains this agent is willing to settle to. */
  readonly supportedDestinationChainIds: readonly number[];
  /** Whether the destination vault already consumed this intent. */
  readonly alreadyFilled: boolean;
}

const fail = (code: ErrorCode, detail: string): VerificationResult => ({ ok: false, code, detail });

const sameAddress = (a: string | null, b: string): boolean =>
  a !== null && a.toLowerCase() === b.toLowerCase();

export function verifySourceTransaction(
  intent: Intent,
  evidence: SourceEvidence,
  context: VerificationContext,
): VerificationResult {
  // --- Is this transaction real and successful? ----------------------------

  if (evidence.status === null) {
    return fail(ErrorCode.SOURCE_TX_NOT_FOUND, `No receipt for ${evidence.txHash}.`);
  }
  if (evidence.status === 'reverted') {
    return fail(ErrorCode.SOURCE_TX_REVERTED, `Source transaction ${evidence.txHash} reverted.`);
  }
  if (evidence.txHash.toLowerCase() !== intent.sourceTxHash.toLowerCase()) {
    return fail(
      ErrorCode.INTENT_FIELDS_MISMATCH,
      'Evidence was read for a different transaction than the intent names.',
    );
  }

  // --- Is it our router? ---------------------------------------------------

  if (!sameAddress(evidence.to, context.expectedRouter)) {
    return fail(
      ErrorCode.SOURCE_ROUTER_MISMATCH,
      `Transaction targeted ${evidence.to}, not the configured router ${context.expectedRouter}.`,
    );
  }

  const event = evidence.intentCreated;
  if (event === null) {
    return fail(ErrorCode.INTENT_EVENT_MISSING, 'No IntentCreated event in the source receipt.');
  }
  // An event from some other contract is not evidence about our router.
  if (!sameAddress(event.emitter, context.expectedRouter)) {
    return fail(
      ErrorCode.SOURCE_ROUTER_MISMATCH,
      `IntentCreated was emitted by ${event.emitter}, not the configured router.`,
    );
  }

  // --- Does it say what we were told? --------------------------------------

  const mismatches = fieldMismatches(intent, event);
  if (mismatches.length > 0) {
    return fail(
      ErrorCode.INTENT_FIELDS_MISMATCH,
      `Onchain intent differs from the candidate: ${mismatches.join(', ')}.`,
    );
  }

  // --- Is it an intent we are willing to act on? ---------------------------

  if (!sameAddress(event.inputToken, context.expectedAsset)) {
    return fail(
      ErrorCode.ASSET_NOT_ALLOWLISTED,
      `Intent is denominated in ${event.inputToken}, not the configured settlement asset.`,
    );
  }
  if (!context.supportedDestinationChainIds.includes(event.destinationChainId)) {
    return fail(
      ErrorCode.ROUTE_NOT_SUPPORTED,
      `Destination chain ${event.destinationChainId} is not supported.`,
    );
  }
  if (isZeroWord(event.settlementRef)) {
    return fail(
      ErrorCode.SETTLEMENT_NOT_INITIATED,
      'Intent carries no settlement reference, so canonical settlement was never committed.',
    );
  }
  if (event.amount === 0n) {
    return fail(ErrorCode.INTENT_FIELDS_MISMATCH, 'Onchain intent has a zero amount.');
  }

  // --- Is it still actionable? ---------------------------------------------

  if (context.alreadyFilled) {
    return fail(ErrorCode.ALREADY_FILLED, `Intent ${intent.intentId} has already been filled.`);
  }
  if (event.deadline <= context.now) {
    return fail(ErrorCode.DEADLINE_IN_PAST, `Intent deadline ${event.deadline} has passed.`);
  }

  return { ok: true, confirmations: confirmationsFor(evidence) };
}

/**
 * Confirmations behind the source transaction.
 *
 * A transaction in the head block has one confirmation, not zero. A head behind
 * the transaction's own block means the node is lagging or reporting
 * inconsistently, which counts as no confirmations rather than a negative
 * number — the caller then refuses on the confirmation threshold rather than
 * accidentally passing it.
 */
export function confirmationsFor(evidence: SourceEvidence): number {
  if (evidence.currentBlockNumber < evidence.blockNumber) return 0;
  return Number(evidence.currentBlockNumber - evidence.blockNumber) + 1;
}

function fieldMismatches(intent: Intent, event: SourceEvidence['intentCreated']): string[] {
  if (event === null) return ['event missing'];
  const problems: string[] = [];

  const check = (name: string, expected: unknown, actual: unknown) => {
    const same =
      typeof expected === 'string' && typeof actual === 'string'
        ? expected.toLowerCase() === actual.toLowerCase()
        : expected === actual;
    if (!same) problems.push(`${name} (expected ${String(expected)}, got ${String(actual)})`);
  };

  check('intentId', intent.intentId, event.intentId);
  check('sender', intent.sender, event.sender);
  check('recipient', intent.recipient, event.recipient);
  check('inputToken', intent.inputToken, event.inputToken);
  check('amount', intent.amount, event.amount);
  check('sourceChainId', intent.sourceChainId, event.sourceChainId);
  check('destinationChainId', intent.destinationChainId, event.destinationChainId);
  check('maxFeeBps', intent.maxFeeBps, event.maxFeeBps);
  check('deadline', intent.deadline, event.deadline);
  check('nonce', intent.nonce, event.nonce);

  return problems;
}

function isZeroWord(value: string): boolean {
  return /^0x0{64}$/i.test(value);
}
