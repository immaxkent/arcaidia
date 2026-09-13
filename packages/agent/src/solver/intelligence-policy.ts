/**
 * D13 (WP-35) — what a solver may do with ecosystem intelligence.
 *
 * `advisory` (default, WP-33 behaviour): the view is written into the decision's narrative and
 * nothing else changes — verdict, fee and amounts are the deterministic policy's, byte for byte.
 *
 * `selective`: the operator lets the view *withhold* an ACCEPT, and only that. The hold fires
 * when both are true at once:
 *   1. the vault's posted fee (`decision.feeBps`) is below the ecosystem median by more than
 *      `holdMarginBps` — this vault is selling capital under the market rate; and
 *   2. `scarcityScoreBps` is at or above `holdScarcityBps` — liquidity is scarce, so the capital
 *      is likely to be asked for again soon at a better-paid tier.
 * A REJECT or PAUSE is never touched, a missing or failing view changes nothing, and a hold is
 * recorded as its own reason (`INTELLIGENCE_HOLD`) with the deterministic verdict kept in the
 * narrative — so the audit trail shows exactly what the policy said and what the operator's
 * setting did with it.
 */
import { DecisionReason, Verdict, type AgentDecision, type EcosystemIntelligence, type IntelligencePaymentReceipt } from '@arcaidia/domain';

export type IntelligenceMode = 'advisory' | 'selective';

export interface IntelligenceSettings {
  readonly mode: IntelligenceMode;
  /** Hold only when scarcity is at or above this. Default 6000 bps. */
  readonly holdScarcityBps: number;
  /** Hold only when the vault's fee is below the median by more than this. Default 5 bps. */
  readonly holdMarginBps: number;
}

export const DEFAULT_INTELLIGENCE_SETTINGS: IntelligenceSettings = {
  mode: 'advisory',
  holdScarcityBps: 6_000,
  holdMarginBps: 5,
};

export function intelligenceNarrative(view: EcosystemIntelligence, receipt: IntelligencePaymentReceipt | null): string {
  const median = view.feeDistribution.medianBps === null ? 'n/a' : `${view.feeDistribution.medianBps} bps`;
  const paid = receipt ? `; paid via x402 on ${receipt.network}, tx ${receipt.transaction}` : '';
  return (
    `ecosystem: liquidity ${view.aggregateAvailableLiquidity.toString()}, ` +
    `utilisation ${view.aggregateUtilisationBps} bps, scarcity ${view.scarcityScoreBps} bps, ` +
    `median fee ${median}${paid}`
  );
}

export interface HoldCheck {
  readonly hold: boolean;
  readonly why: string;
}

export function shouldHold(decision: AgentDecision, view: EcosystemIntelligence, settings: IntelligenceSettings): HoldCheck {
  if (decision.verdict !== Verdict.ACCEPT) return { hold: false, why: 'not an accept' };
  const median = view.feeDistribution.medianBps;
  if (median === null) return { hold: false, why: 'no market median' };
  const gap = median - decision.feeBps;
  if (gap <= settings.holdMarginBps) return { hold: false, why: `fee ${decision.feeBps} bps within ${settings.holdMarginBps} bps of median ${median} bps` };
  if (view.scarcityScoreBps < settings.holdScarcityBps) {
    return { hold: false, why: `scarcity ${view.scarcityScoreBps} bps below ${settings.holdScarcityBps} bps` };
  }
  return {
    hold: true,
    why: `fee ${decision.feeBps} bps is ${gap} bps under median ${median} bps and scarcity ${view.scarcityScoreBps} bps ≥ ${settings.holdScarcityBps} bps`,
  };
}

/** Pure: the decision with the view applied under `settings`. */
export function applyIntelligence(
  decision: AgentDecision,
  view: EcosystemIntelligence,
  receipt: IntelligencePaymentReceipt | null,
  settings: IntelligenceSettings,
): AgentDecision {
  const narrative = intelligenceNarrative(view, receipt);
  if (settings.mode !== 'selective') return { ...decision, narrative };
  const check = shouldHold(decision, view, settings);
  if (!check.hold) return { ...decision, narrative: `${narrative}; selective: no hold (${check.why})` };
  return {
    ...decision,
    verdict: Verdict.REJECT,
    reason: DecisionReason.INTELLIGENCE_HOLD,
    feeBps: 0,
    feeAmount: 0n,
    outputAmount: 0n,
    narrative: `${narrative}; selective: HELD — policy said ACCEPT at ${decision.feeBps} bps, ${check.why}`,
  };
}
