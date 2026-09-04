/**
 * The solver's single entry point.
 *
 * `processIntent(intent)` — never `processEthToArc()` or `processArcToEth()`.
 * Direction is resolved from the intent's own chain ids through the shared
 * configuration, so one code path serves both directions and adding a third
 * chain would be a configuration change rather than a new branch.
 *
 * The order is fixed and each step earns its place:
 *
 *   observe → verify → evaluate → sign → submit
 *
 * Observation comes from The Graph (or an in-memory provider) and is never
 * sufficient on its own. Verification independently re-reads the source
 * receipt, because a compromised indexer must not be able to move LP capital.
 * Evaluation is pure and deterministic. Only then is anything signed.
 */

import {
  ErrorCode,
  Verdict,
  resolveEndpoints,
  resolveRoute,
  type AgentAuthority,
  type AgentDecision,
  type FillAuthorization,
  type Intent,
  type ObservationProvider,
  type RiskPolicy,
  type SignedFillAuthorization,
  type TxHash,
} from '@arcaidia/domain';

import { evaluateIntent } from '../risk/evaluate-intent.js';
import { verifySourceTransaction } from '../verification/verify-source.js';
import type { SourceChainReader } from '../verification/source-evidence.js';
import type { DecisionLog } from '../logging/decision-log.js';
import type { Clock, FillSubmitter, NonceSource, SubmissionJournal } from './ports.js';

export interface SolverConfig {
  readonly policy: RiskPolicy;
  /**
   * How long a signed authorization stays valid. The specification calls for
   * 30–60 seconds: long enough to reach the chain, short enough that a leaked
   * authorization is worthless almost immediately.
   */
  readonly authorizationTtlSeconds: number;
}

export interface SolverDependencies {
  readonly observation: ObservationProvider;
  readonly sourceReader: SourceChainReader;
  readonly authority: AgentAuthority;
  readonly submitter: FillSubmitter;
  readonly log: DecisionLog;
  readonly clock: Clock;
  readonly nonces: NonceSource;
  readonly journal: SubmissionJournal;
  readonly config: SolverConfig;
}

export type ProcessOutcome =
  /** LP capital was advanced and the recipient paid. */
  | { readonly kind: 'FILLED'; readonly decision: AgentDecision; readonly signed: SignedFillAuthorization; readonly txHash: TxHash }
  /** The agent declined, or paused. Canonical settlement remains the user's path. */
  | { readonly kind: 'DECLINED'; readonly decision: AgentDecision }
  /** The source evidence did not support the intent. Nothing was signed. */
  | { readonly kind: 'UNVERIFIED'; readonly code: ErrorCode; readonly detail: string }
  /** Already handled: onchain, or by this process. */
  | { readonly kind: 'SKIPPED'; readonly reason: 'ALREADY_FILLED' | 'ALREADY_ATTEMPTED' }
  /** Signed and accepted, but the transaction did not land. Safe to retry. */
  | { readonly kind: 'SUBMISSION_FAILED'; readonly decision: AgentDecision; readonly signed: SignedFillAuthorization; readonly error: Error };

export async function processIntent(
  intent: Intent,
  deps: SolverDependencies,
): Promise<ProcessOutcome> {
  const { observation, sourceReader, authority, submitter, log, clock, nonces, journal, config } =
    deps;

  // Direction is data: these two fields decide every endpoint below.
  const route = resolveRoute(intent.sourceChainId, intent.destinationChainId);
  const endpoints = resolveEndpoints(route);

  if (journal.has(intent.intentId)) {
    return { kind: 'SKIPPED', reason: 'ALREADY_ATTEMPTED' };
  }

  const alreadyFilled = await observation.isFilled(intent.intentId);
  if (alreadyFilled) {
    return { kind: 'SKIPPED', reason: 'ALREADY_FILLED' };
  }

  const now = clock();

  // --- Verify the source before anything else is considered ----------------

  const evidence = await sourceReader.readEvidence(intent.sourceChainId, intent.sourceTxHash);
  const verification = verifySourceTransaction(intent, evidence, {
    now,
    expectedRouter: endpoints.sourceRouter,
    expectedAsset: route.source.settlementAsset.address,
    supportedDestinationChainIds: [route.destination.chainId],
    alreadyFilled,
  });

  if (!verification.ok) {
    return { kind: 'UNVERIFIED', code: verification.code, detail: verification.detail };
  }

  // --- Decide --------------------------------------------------------------

  const [vaultState, settlementHealth] = await Promise.all([
    observation.vaultState(route.destination.chainId),
    observation.settlementHealth(),
  ]);

  const decision = evaluateIntent(intent, vaultState, settlementHealth, config.policy, {
    now,
    sourceConfirmations: verification.confirmations,
    alreadyFilled,
  });

  // Logged before acting, so a decision exists in the record even if submission
  // later fails. A log written only on success would hide exactly the runs
  // worth investigating.
  log.record(decision);

  if (decision.verdict !== Verdict.ACCEPT) {
    return { kind: 'DECLINED', decision };
  }

  // --- Authorise -----------------------------------------------------------

  const authorization: FillAuthorization = {
    intentId: intent.intentId,
    sourceChainId: intent.sourceChainId,
    sourceTxHash: intent.sourceTxHash,
    recipient: intent.recipient,
    inputAmount: intent.amount,
    outputAmount: decision.outputAmount,
    feeAmount: decision.feeAmount,
    expiry: now + config.authorizationTtlSeconds,
    nonce: await nonces.next(),
  };

  const signed = await authority.signFillAuthorization(authorization, {
    chainId: route.destination.chainId,
    verifyingContract: endpoints.destinationVault,
  });

  // Marked before submitting: a transaction that lands after a timeout still
  // moved funds, so a retry must not assume failure means nothing happened.
  journal.mark(intent.intentId);

  try {
    const txHash = await submitter.submitFastFill(
      route.destination.chainId,
      endpoints.destinationVault,
      signed,
    );
    return { kind: 'FILLED', decision, signed, txHash };
  } catch (error) {
    return {
      kind: 'SUBMISSION_FAILED',
      decision,
      signed,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
