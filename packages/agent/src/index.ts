/**
 * @arcaidia/agent — the solver's decision logic.
 *
 * Capital-safety decisions live here and are deterministic and pure. An LLM may
 * narrate a decision downstream of the verdict; it may never produce one.
 */

export { evaluateIntent } from './risk/evaluate-intent.js';
export type { EvaluationContext } from './risk/evaluate-intent.js';
export { DEFAULT_RISK_POLICY } from './risk/default-policy.js';
export {
  utilisationFeeBps,
  requiredFeeBps,
  isSettlementSlowing,
  feeAmountFor,
  effectiveMaxFillAmount,
} from './risk/fee.js';
export { requiredConfirmations } from './risk/confirmations.js';

// Source verification — the independent RPC check before capital moves
export { verifySourceTransaction, confirmationsFor } from './verification/verify-source.js';
export type { VerificationResult, VerificationContext } from './verification/verify-source.js';
export type {
  SourceEvidence,
  IntentCreatedEvidence,
  SourceChainReader,
} from './verification/source-evidence.js';

// Decision records
export {
  serialiseDecision,
  formatDecisionSummary,
  InMemoryDecisionLog,
  JsonLinesDecisionLog,
} from './logging/decision-log.js';
export type { DecisionLog, DecisionLogRecord, SerialisedInputs } from './logging/decision-log.js';
