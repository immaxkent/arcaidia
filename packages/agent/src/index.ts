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

// Agent authority — local now, Circle Agent Wallet in WP-09
export { LocalAgentSigner } from './signing/local-agent-signer.js';
export type { FillAuthorizationDomainInput } from './signing/local-agent-signer.js';

// Orchestration — one entry point, direction resolved from configuration
export { processIntent } from './solver/process-intent.js';
export type {
  SolverConfig,
  SolverDependencies,
  ProcessOutcome,
} from './solver/process-intent.js';
export {
  SequentialNonceSource,
  InMemorySubmissionJournal,
} from './solver/ports.js';
export type {
  FillSubmitter,
  NonceSource,
  Clock,
  SubmissionJournal,
} from './solver/ports.js';

// RPC adapters behind the solver's ports
export { ViemSourceChainReader, decodeIntentCreated } from './adapters/viem-source-reader.js';
export { ViemFillSubmitter } from './adapters/viem-fill-submitter.js';
export type {
  EvmReadClient,
  EvmWriteClient,
  EvmLog,
  EvmReceipt,
} from './adapters/evm-clients.js';

// Observation — a local cache standing in for The Graph until WP-08
export { InMemoryObservationProvider } from './observation/in-memory-observation-provider.js';
