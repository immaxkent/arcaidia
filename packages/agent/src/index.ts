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
