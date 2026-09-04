/**
 * Decision records.
 *
 * Every time LP capital was, or was not, put at risk, this is the evidence.
 * Two audiences: an operator reconstructing why a quote was what it was, and
 * the demo's decision panel showing the live inputs behind an accept.
 *
 * `bigint` does not survive `JSON.stringify`, so amounts are serialised as
 * decimal strings rather than numbers — a number would silently lose precision
 * above 2^53, which for a six-decimal asset is only about nine billion units.
 */

import type { AgentDecision, DecisionInputs } from '@arcaidia/domain';

/** A JSON-safe decision record. */
export interface DecisionLogRecord {
  readonly intentId: string;
  readonly verdict: string;
  readonly reason: string;
  readonly feeBps: number;
  readonly feeAmount: string;
  readonly outputAmount: string;
  readonly policyVersion: string;
  readonly decidedAt: number;
  readonly inputs: SerialisedInputs;
  readonly narrative?: string;
}

export interface SerialisedInputs {
  readonly requestedAmount: string;
  readonly availableLiquidity: string;
  readonly reserveFloor: string;
  readonly outstandingExposure: string;
  readonly utilisationBps: number;
  readonly userMaxFeeBps: number;
  readonly sourceConfirmations: number;
  readonly requiredConfirmations: number;
  readonly observationAgeSeconds: number;
  readonly settlement: {
    readonly transport: string;
    readonly oldestUnsettledAgeSeconds: number | null;
    readonly pendingValue: string;
    readonly averageSettlementLatencySeconds: number | null;
    readonly latencySampleSize: number;
    readonly observedAt: number;
  };
}

function serialiseInputs(inputs: DecisionInputs): SerialisedInputs {
  return {
    requestedAmount: inputs.requestedAmount.toString(),
    availableLiquidity: inputs.availableLiquidity.toString(),
    reserveFloor: inputs.reserveFloor.toString(),
    outstandingExposure: inputs.outstandingExposure.toString(),
    utilisationBps: inputs.utilisationBps,
    userMaxFeeBps: inputs.userMaxFeeBps,
    sourceConfirmations: inputs.sourceConfirmations,
    requiredConfirmations: inputs.requiredConfirmations,
    observationAgeSeconds: inputs.observationAgeSeconds,
    settlement: {
      transport: inputs.settlementHealth.transport,
      oldestUnsettledAgeSeconds: inputs.settlementHealth.oldestUnsettledAgeSeconds,
      pendingValue: inputs.settlementHealth.pendingValue.toString(),
      averageSettlementLatencySeconds: inputs.settlementHealth.averageSettlementLatencySeconds,
      latencySampleSize: inputs.settlementHealth.latencySampleSize,
      observedAt: inputs.settlementHealth.observedAt,
    },
  };
}

/**
 * Turn a decision into a JSON-safe record.
 *
 * Every input the verdict depended on is carried, so the quote can be
 * recomputed from the record alone. A record that omitted an input would be a
 * log entry rather than an audit trail.
 */
export function serialiseDecision(decision: AgentDecision): DecisionLogRecord {
  const record: DecisionLogRecord = {
    intentId: decision.intentId,
    verdict: decision.verdict,
    reason: decision.reason,
    feeBps: decision.feeBps,
    feeAmount: decision.feeAmount.toString(),
    outputAmount: decision.outputAmount.toString(),
    policyVersion: decision.policyVersion,
    decidedAt: decision.decidedAt,
    inputs: serialiseInputs(decision.inputsUsed),
  };

  return decision.narrative === undefined ? record : { ...record, narrative: decision.narrative };
}

/**
 * A one-line summary for operators watching a live run.
 *
 * States the verdict, the reason and the numbers behind it. Deliberately terse
 * and deliberately complete: an operator should not have to open the JSON to
 * understand why a fill was refused.
 */
export function formatDecisionSummary(decision: AgentDecision): string {
  const { inputsUsed: inputs } = decision;
  const shortId = `${decision.intentId.slice(0, 10)}…`;

  const economics =
    decision.verdict === 'ACCEPT'
      ? `fee ${decision.feeBps}bps (${decision.feeAmount}) out ${decision.outputAmount}`
      : 'no quote';

  return [
    `${decision.verdict} ${shortId}`,
    decision.reason,
    economics,
    `amount ${inputs.requestedAmount}`,
    `liquidity ${inputs.availableLiquidity}`,
    `exposure ${inputs.outstandingExposure}`,
    `utilisation ${inputs.utilisationBps}bps`,
    `confirmations ${inputs.sourceConfirmations}/${inputs.requiredConfirmations}`,
    `settlement ${inputs.settlementHealth.transport}`,
    `policy ${decision.policyVersion}`,
  ].join(' · ');
}

/**
 * Where decision records go.
 *
 * A port rather than a direct console call, so the same decisions can feed a
 * test assertion, an operator's terminal and the UI without the engine knowing
 * which is listening.
 */
export interface DecisionLog {
  record(decision: AgentDecision): void;
}

/** Collects records in memory. Used by tests and by the local E2E harness. */
export class InMemoryDecisionLog implements DecisionLog {
  private readonly entries: DecisionLogRecord[] = [];

  record(decision: AgentDecision): void {
    this.entries.push(serialiseDecision(decision));
  }

  all(): readonly DecisionLogRecord[] {
    return this.entries;
  }

  forIntent(intentId: string): readonly DecisionLogRecord[] {
    return this.entries.filter((entry) => entry.intentId.toLowerCase() === intentId.toLowerCase());
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/** Writes one JSON object per line, for an operator or a log collector. */
export class JsonLinesDecisionLog implements DecisionLog {
  constructor(private readonly write: (line: string) => void = console.log) {}

  record(decision: AgentDecision): void {
    this.write(JSON.stringify(serialiseDecision(decision)));
  }
}
