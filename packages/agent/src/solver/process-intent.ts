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
  type IntelligenceProvider,
  type ObservationProvider,
  type RiskPolicy,
  type SignedFillAuthorization,
  type SwapAdapter,
  type TxHash,
} from '@arcaidia/domain';
import { isTradeIntent } from '@arcaidia/domain';
import { NoopTelemetryClient, type TelemetryClient, type TelemetryStage } from '@arcaidia/telemetry';

import { evaluateIntent } from '../risk/evaluate-intent.js';
import { verifySourceTransaction } from '../verification/verify-source.js';
import type { SourceChainReader } from '../verification/source-evidence.js';
import type { DecisionLog } from '../logging/decision-log.js';
import type { Clock, FillSubmitter, NonceSource, SubmissionJournal } from './ports.js';

const NOOP_TELEMETRY = new NoopTelemetryClient();

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
  /**
   * Optional, not defaulted away by accident: unset behaves exactly like an
   * explicit `NoopTelemetryClient` (`TELEMETRY_ENABLED=false`), because
   * telemetry is pre-chain observation only — WP-17's own acceptance gate is
   * that every fill still completes correctly with this entirely absent.
   */
  readonly telemetry?: TelemetryClient;
  /**
   * Optional (D9, WP-34): lets this solver fill trade intents by asking
   * whether the destination swap can meet the user's floor. Absent = baseline
   * solver: every trade intent is declined (`TRADE_NOT_SUPPORTED`).
   */
  readonly swapAdapter?: SwapAdapter;
  /**
   * Optional (WP-33/35): ecosystem intelligence, consulted *after* the
   * deterministic verdict and recorded only as narrative. Never the gate
   * (working agreement rule 4); a provider that fails or lies changes nothing.
   */
  readonly intelligence?: IntelligenceProvider;
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
  const telemetry = deps.telemetry ?? NOOP_TELEMETRY;

  // Direction is data: these two fields decide every endpoint below.
  const route = resolveRoute(intent.sourceChainId, intent.destinationChainId);
  const endpoints = resolveEndpoints(route);

  // Pre-chain and purely informational — see the `telemetry` field's own doc comment. Skipped
  // (not merely no-op'd) for the two short-circuit returns just below: an intent this pass
  // already knows is done or already attempted was never really "in progress" here.
  //
  // Wrapped defensively even though `HttpTelemetryClient` is itself careful never to throw or
  // block: WP-17's acceptance gate is that telemetry can never affect a fill, and that guarantee
  // should not rest entirely on every implementation of this interface remembering to uphold it.
  const report = (stage: TelemetryStage) => {
    try {
      telemetry.reportStage({
        chainId: intent.destinationChainId,
        stage,
        intentId: intent.intentId,
        vaultAddress: endpoints.destinationVault,
        at: clock(),
      });
    } catch {
      // Deliberately silent — see the comment above.
    }
  };

  if (journal.has(intent.intentId)) {
    return { kind: 'SKIPPED', reason: 'ALREADY_ATTEMPTED' };
  }

  const alreadyFilled = await observation.isFilled(intent.intentId);
  if (alreadyFilled) {
    return { kind: 'SKIPPED', reason: 'ALREADY_FILLED' };
  }

  report('INTENT_DISCOVERED');

  const now = clock();

  // --- Verify the source before anything else is considered ----------------

  report('VERIFYING_SOURCE');
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

  report('FORMULATING_FILL');
  const [vaultState, settlementHealth] = await Promise.all([
    observation.vaultState(route.destination.chainId),
    observation.settlementHealth(),
  ]);

  const tradeSatisfiable = await tradeSatisfiabilityOf(intent, vaultState.asset, deps.swapAdapter);

  const verdict = evaluateIntent(intent, vaultState, settlementHealth, config.policy, {
    now,
    sourceConfirmations: verification.confirmations,
    alreadyFilled,
    tradeSatisfiable,
  });
  const decision = await withIntelligenceNarrative(verdict, deps.intelligence, now);

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

  report('SUBMITTING_SETTLEMENT');
  try {
    const txHash = await submitter.submitFastFill(
      route.destination.chainId,
      endpoints.destinationVault,
      intent,
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

/**
 * Whether a trade intent's floor is meetable right now — `null` for plain USDC
 * transfers and for a solver with no adapter. An adapter that throws is
 * treated as "cannot satisfy" rather than as an error: the fill is simply not
 * made, and canonical settlement still delivers USDC.
 */
async function tradeSatisfiabilityOf(
  intent: Intent,
  asset: `0x${string}`,
  adapter: SwapAdapter | undefined,
): Promise<boolean | null> {
  if (!isTradeIntent(intent) || !adapter) return null;
  try {
    return await adapter.canSatisfy(
      intent.destinationChainId,
      asset,
      intent.tokenOut,
      intent.amount,
      intent.targetMinOut,
    );
  } catch {
    return false;
  }
}

/**
 * Attach an intelligence summary to the decision's narrative, if a provider is
 * configured and answers. The verdict, fee and amounts are already fixed by
 * the time this runs — nothing here can change them, by construction.
 */
async function withIntelligenceNarrative(
  decision: AgentDecision,
  intelligence: IntelligenceProvider | undefined,
  now: number,
): Promise<AgentDecision> {
  if (!intelligence) return decision;
  try {
    const view = await intelligence.ecosystem(now);
    const narrative =
      `ecosystem: liquidity ${view.aggregateAvailableLiquidity.toString()}, ` +
      `utilisation ${view.aggregateUtilisationBps} bps, scarcity ${view.scarcityScoreBps} bps`;
    return { ...decision, narrative };
  } catch {
    return decision;
  }
}
