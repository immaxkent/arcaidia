/**
 * A pre-submission fee/output estimate (WP-14).
 *
 * `evaluateIntent` is pure and already reads live `VaultState`/`SettlementHealth`
 * every real solver pass — this reuses it verbatim rather than reimplementing
 * any pricing logic. The one thing a quote cannot have that a real decision
 * does is `EvaluationContext`: `sourceConfirmations` and `alreadyFilled`
 * describe a transaction that has not been sent yet. Rather than guess, this
 * states the assumption explicitly — the confirmation threshold the amount
 * would require is treated as already met, and nothing has been filled. That
 * makes the result an estimate under a stated best-case assumption, not a
 * binding quote: the real decision, against the real observed confirmation
 * count, happens exactly the way it does today once an intent actually lands
 * on the source chain.
 *
 * Every field `evaluateIntent` does not use for pricing (`intentId`, `sender`,
 * `recipient`, `nonce`, `sourceTxHash`, `sourceBlockNumber`, `settlementRef`)
 * takes a zero placeholder — this intent was never created and never will be
 * under this id.
 */

import {
  INTENT_VERSION,
  USDC_TOKEN_OUT,
  type Address,
  type AgentDecision,
  type Bytes32,
  type Intent,
  type ObservationProvider,
  type RiskPolicy,
  type UnixSeconds,
} from '@arcaidia/domain';
import { evaluateIntent } from './evaluate-intent.js';
import { requiredConfirmations } from './confirmations.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as Bytes32;

/** How far out a quote's synthetic deadline is set — irrelevant to pricing, only to the expiry gate. */
const QUOTE_DEADLINE_WINDOW_SECONDS = 3600;

export interface QuoteRequest {
  readonly amount: bigint;
  readonly maxFeeBps: number;
  readonly sourceChainId: number;
  readonly destinationChainId: number;
  /** Trade-intent fields (schema v1.1). Omitted means a plain USDC transfer. Priced in WP-28. */
  readonly tokenOut?: Address;
  readonly targetMinOut?: bigint;
}

export class InvalidQuoteRequestError extends Error {}

export interface QuoteResult extends AgentDecision {
  /** Marks this as a forecast under the assumption above, never a recorded decision. */
  readonly estimatedUnderAssumption: true;
}

export interface QuoteDependencies {
  readonly observation: ObservationProvider;
  readonly policy: RiskPolicy;
  readonly clock: () => UnixSeconds;
}

function validate(request: QuoteRequest): void {
  if (request.amount <= 0n) throw new InvalidQuoteRequestError('amount must be positive.');
  if (request.maxFeeBps < 0 || request.maxFeeBps > 10_000) {
    throw new InvalidQuoteRequestError('maxFeeBps must be between 0 and 10000.');
  }
  if (request.sourceChainId === request.destinationChainId) {
    throw new InvalidQuoteRequestError('sourceChainId and destinationChainId must differ.');
  }
}

export async function buildQuote(request: QuoteRequest, deps: QuoteDependencies): Promise<QuoteResult> {
  validate(request);
  const now = deps.clock();

  const intent: Intent = {
    intentVersion: INTENT_VERSION,
    tokenOut: request.tokenOut ?? USDC_TOKEN_OUT,
    targetMinOut: request.targetMinOut ?? 0n,
    intentId: ZERO_BYTES32,
    sender: ZERO_ADDRESS,
    recipient: ZERO_ADDRESS,
    inputToken: ZERO_ADDRESS,
    amount: request.amount,
    sourceChainId: request.sourceChainId,
    destinationChainId: request.destinationChainId,
    maxFeeBps: request.maxFeeBps,
    deadline: now + QUOTE_DEADLINE_WINDOW_SECONDS,
    nonce: 0n,
    sourceTxHash: ZERO_BYTES32,
    sourceBlockNumber: 0n,
    createdAt: now,
    settlementRef: ZERO_BYTES32,
  };

  const [vaultState, settlementHealth] = await Promise.all([
    deps.observation.vaultState(request.destinationChainId),
    deps.observation.settlementHealth(),
  ]);

  const decision = evaluateIntent(intent, vaultState, settlementHealth, deps.policy, {
    now,
    sourceConfirmations: requiredConfirmations(deps.policy, request.amount),
    alreadyFilled: false,
  });

  return { ...decision, estimatedUnderAssumption: true };
}
