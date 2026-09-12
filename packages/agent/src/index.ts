/**
 * @arcaidia/agent — the solver's decision logic.
 *
 * Capital-safety decisions live here and are deterministic and pure. An LLM may
 * narrate a decision downstream of the verdict; it may never produce one.
 */

export { evaluateIntent } from './risk/evaluate-intent.js';
export type { EvaluationContext } from './risk/evaluate-intent.js';
export { buildQuote, InvalidQuoteRequestError } from './risk/build-quote.js';
export type { QuoteRequest, QuoteResult, QuoteDependencies } from './risk/build-quote.js';
export { DEFAULT_RISK_POLICY } from './risk/default-policy.js';
export {
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

// Agent authority — LocalAgentSigner (dev/tests) or CircleAgentWalletSigner (WP-09)
export { LocalAgentSigner } from './signing/local-agent-signer.js';
export type { FillAuthorizationDomainInput } from './signing/local-agent-signer.js';
export {
  buildCircleSigningClient,
  CircleAgentWalletSigner,
  CircleSigningError,
} from './signing/circle-agent-wallet-signer.js';
export type { CircleSigningClient } from './signing/circle-agent-wallet-signer.js';

// Orchestration — one entry point, direction resolved from configuration
export { processIntent } from './solver/process-intent.js';
export type {
  SolverConfig,
  SolverDependencies,
  ProcessOutcome,
} from './solver/process-intent.js';
export {
  SequentialNonceSource,
  RandomNonceSource,
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
export { ViemFillSubmitter, FillRevertedError } from './adapters/viem-fill-submitter.js';
export type {
  EvmReadClient,
  EvmWriteClient,
  EvmContractReadClient,
  EvmLog,
  EvmReceipt,
} from './adapters/evm-clients.js';

// Observation — GraphObservationProvider once a subgraph is deployed (WP-08);
// InMemoryObservationProvider stands in for tests and local runs either way.
export { InMemoryObservationProvider } from './observation/in-memory-observation-provider.js';
export { GraphObservationProvider } from './observation/graph-observation-provider.js';
export type {
  GraphChainSource,
  GraphObservationOptions,
} from './observation/graph-observation-provider.js';
export { FetchGraphQueryClient } from './observation/graph-client.js';
export type { GraphQueryClient } from './observation/graph-client.js';

// SqlNestObservationProvider — Arcaidia's shared, unlimited indexer (WP-22),
// the live entrypoint's default. Same ObservationProvider contract as
// GraphObservationProvider above, SQL-over-HTTP instead of GraphQL.
export { SqlNestObservationProvider } from './observation/sql-nest-observation-provider.js';
export type {
  NestChainSource,
  SqlNestObservationOptions,
} from './observation/sql-nest-observation-provider.js';
export { FetchNestQueryClient } from './observation/nest-client.js';
export type { NestQueryClient, NestQueryResult } from './observation/nest-client.js';

// The worker — WP-11. runSolverPass is one discover-and-process cycle;
// startSolverWorker is "keep doing that forever" around it.
export { runSolverPass } from './worker/run-solver-pass.js';
export type { SolverPassOutcome, SolverPassResult } from './worker/run-solver-pass.js';
export { startSolverWorker } from './worker/solver-worker.js';
export type { SolverWorkerHandle, SolverWorkerOptions } from './worker/solver-worker.js';
