/**
 * The decision.
 *
 * `evaluateIntent` is a pure function. Given the same intent, vault state,
 * settlement health and policy it returns the same verdict forever — which is
 * what makes a quote auditable after the fact and what keeps an LLM out of the
 * path that moves capital.
 *
 * Nothing here reaches the network. Source verification is a separate, impure
 * step (`verifySourceTransaction`) whose *result* arrives as
 * `context.sourceConfirmations` and `context.alreadyFilled`. Keeping them apart
 * is deliberate: it is what allows every branch below to be exercised in a unit
 * test rather than against a live chain.
 */

import {
  DecisionReason,
  Verdict,
  availableLiquidity,
  utilisationBps,
  type AgentDecision,
  type DecisionInputs,
  type Intent,
  type RiskPolicy,
  type SettlementHealth,
  type UnixSeconds,
  type VaultState,
} from '@arcaidia/domain';

import { effectiveMaxFillAmount, feeAmountFor, requiredFeeBps } from './fee.js';
import { requiredConfirmations } from './confirmations.js';

/** What the agent learned from the chain, passed in rather than fetched here. */
export interface EvaluationContext {
  readonly now: UnixSeconds;
  /** Confirmations observed on the source transaction. */
  readonly sourceConfirmations: number;
  /** Whether the destination vault already consumed this intent. */
  readonly alreadyFilled: boolean;
}

export function evaluateIntent(
  intent: Intent,
  vault: VaultState,
  settlement: SettlementHealth,
  policy: RiskPolicy,
  context: EvaluationContext,
): AgentDecision {
  const utilisation = utilisationBps(vault);
  const available = availableLiquidity(vault);
  const required = requiredConfirmations(policy, intent.amount);
  const observationAgeSeconds = Math.max(0, context.now - vault.observedAt);

  const inputs: DecisionInputs = {
    requestedAmount: intent.amount,
    availableLiquidity: available,
    reserveFloor: vault.reserveFloor,
    outstandingExposure: vault.outstandingExposure,
    utilisationBps: utilisation,
    userMaxFeeBps: intent.maxFeeBps,
    sourceConfirmations: context.sourceConfirmations,
    requiredConfirmations: required,
    settlementHealth: settlement,
    observationAgeSeconds,
  };

  const refuse = (verdict: typeof Verdict.REJECT | typeof Verdict.PAUSE, reason: DecisionReason) =>
    decision(intent, verdict, reason, 0, 0n, 0n, inputs, policy, context.now);

  // --- Transport-level conditions: about the system, not this intent --------

  // Pause rather than reject: nothing is wrong with the intent, and the
  // settlement agent keeps reconciling while new advances are held back.
  if (settlement.transport === 'UNAVAILABLE') {
    return refuse(Verdict.PAUSE, DecisionReason.SETTLEMENT_TRANSPORT_UNAVAILABLE);
  }
  if (vault.paused) {
    return refuse(Verdict.PAUSE, DecisionReason.VAULT_PAUSED);
  }

  // A backlog is a property of the system too, but it is a reason to stop
  // adding to exposure rather than to stop operating.
  if (settlement.pendingValue > policy.settlement.backlogRejectValue) {
    return refuse(Verdict.REJECT, DecisionReason.SETTLEMENT_BACKLOG);
  }
  if (
    settlement.oldestUnsettledAgeSeconds !== null &&
    settlement.oldestUnsettledAgeSeconds > policy.settlement.maxOldestUnsettledAgeSeconds
  ) {
    return refuse(Verdict.REJECT, DecisionReason.SETTLEMENT_BACKLOG);
  }

  // --- Evidence quality ----------------------------------------------------

  if (observationAgeSeconds > policy.maxObservationAgeSeconds) {
    return refuse(Verdict.REJECT, DecisionReason.OBSERVATION_STALE);
  }
  if (context.alreadyFilled) {
    return refuse(Verdict.REJECT, DecisionReason.ALREADY_FILLED);
  }
  if (intent.deadline <= context.now) {
    return refuse(Verdict.REJECT, DecisionReason.DEADLINE_PASSED);
  }
  if (context.sourceConfirmations < required) {
    return refuse(Verdict.REJECT, DecisionReason.INSUFFICIENT_CONFIRMATIONS);
  }

  // --- Size ----------------------------------------------------------------

  if (intent.amount > effectiveMaxFillAmount(policy, settlement)) {
    return refuse(Verdict.REJECT, DecisionReason.INTENT_SIZE_CAP_BREACH);
  }

  // --- Price ---------------------------------------------------------------

  const feeBps = requiredFeeBps(policy, utilisation, settlement);

  // Rejected rather than clamped: charging the ceiling would mean knowingly
  // taking risk we have already priced as underpaid.
  if (feeBps > policy.maxFeeBps) {
    return refuse(Verdict.REJECT, DecisionReason.FEE_EXCEEDS_PROTOCOL_CEILING);
  }
  // The user's ceiling is a hard limit, and exceeding it is a rejection rather
  // than a silent reduction, which would hide a mispriced risk.
  if (feeBps > intent.maxFeeBps) {
    return refuse(Verdict.REJECT, DecisionReason.FEE_CEILING_EXCEEDED);
  }

  const feeAmount = feeAmountFor(intent.amount, feeBps);
  const outputAmount = intent.amount - feeAmount;

  if (outputAmount <= 0n) {
    return refuse(Verdict.REJECT, DecisionReason.INTENT_SIZE_CAP_BREACH);
  }

  // --- Capital -------------------------------------------------------------

  if (outputAmount > available) {
    return refuse(Verdict.REJECT, DecisionReason.INSUFFICIENT_LIQUIDITY);
  }
  if (vault.outstandingExposure + outputAmount > policy.maxOutstandingExposure) {
    return refuse(Verdict.REJECT, DecisionReason.EXPOSURE_CAP_BREACH);
  }

  return decision(
    intent,
    Verdict.ACCEPT,
    DecisionReason.ACCEPTED,
    feeBps,
    feeAmount,
    outputAmount,
    inputs,
    policy,
    context.now,
  );
}

function decision(
  intent: Intent,
  verdict: Verdict,
  reason: DecisionReason,
  feeBps: number,
  feeAmount: bigint,
  outputAmount: bigint,
  inputsUsed: DecisionInputs,
  policy: RiskPolicy,
  decidedAt: UnixSeconds,
): AgentDecision {
  return {
    intentId: intent.intentId,
    verdict,
    reason,
    feeBps,
    feeAmount,
    outputAmount,
    inputsUsed,
    policyVersion: policy.version,
    decidedAt,
  };
}
