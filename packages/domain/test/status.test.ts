import { describe, expect, it } from 'vitest';
import {
  CanonicalOutcome,
  CanonicalStatus,
  FastStatus,
  describeSettlementState,
  isCanonicallyFinal,
  isLpExposed,
  isRecipientPaid,
  type IntentSettlementState,
} from '../src/index.js';

const intentId = '0x'.padEnd(66, 'a') as `0x${string}`;

function state(partial: Partial<IntentSettlementState> = {}): IntentSettlementState {
  return {
    intentId,
    fastStatus: FastStatus.PENDING,
    canonicalStatus: CanonicalStatus.PENDING,
    ...partial,
  };
}

describe('the dual settlement state model', () => {
  it('describes all four cells of the specification §9 matrix distinctly', () => {
    const descriptions = [
      describeSettlementState({ fastStatus: FastStatus.PENDING, canonicalStatus: CanonicalStatus.PENDING }),
      describeSettlementState({ fastStatus: FastStatus.FAST_FILLED, canonicalStatus: CanonicalStatus.PENDING }),
      describeSettlementState({ fastStatus: FastStatus.PENDING, canonicalStatus: CanonicalStatus.SETTLED }),
      describeSettlementState({ fastStatus: FastStatus.FAST_FILLED, canonicalStatus: CanonicalStatus.SETTLED }),
    ];
    expect(new Set(descriptions).size).toBe(4);
  });

  it('treats "recipient paid" and "canonically final" as independent facts', () => {
    const fastFilledOnly = state({ fastStatus: FastStatus.FAST_FILLED });
    expect(isRecipientPaid(fastFilledOnly)).toBe(true);
    expect(isCanonicallyFinal(fastFilledOnly)).toBe(false);

    const settledOnly = state({
      canonicalStatus: CanonicalStatus.SETTLED,
      canonicalOutcome: CanonicalOutcome.RECIPIENT_FALLBACK,
    });
    expect(isRecipientPaid(settledOnly)).toBe(true);
    expect(isCanonicallyFinal(settledOnly)).toBe(true);
  });

  it('reports LP exposure only while an advance is unreimbursed', () => {
    expect(isLpExposed(state())).toBe(false);
    expect(isLpExposed(state({ fastStatus: FastStatus.FAST_FILLED }))).toBe(true);
    expect(
      isLpExposed(
        state({
          fastStatus: FastStatus.FAST_FILLED,
          canonicalStatus: CanonicalStatus.SETTLED,
          canonicalOutcome: CanonicalOutcome.LP_REIMBURSED,
        }),
      ),
    ).toBe(false);
  });

  it('does not consider a fast-filled intent finished', () => {
    // The single most important assertion in this package: a recipient holding
    // LP funds is not a settled intent, and no helper may say otherwise.
    const fastFilled = state({ fastStatus: FastStatus.FAST_FILLED });
    expect(isRecipientPaid(fastFilled)).toBe(true);
    expect(isCanonicallyFinal(fastFilled)).toBe(false);
    expect(isLpExposed(fastFilled)).toBe(true);
  });

  it('does not treat an unfilled but canonically settled intent as LP-reimbursed', () => {
    const fallback = state({
      canonicalStatus: CanonicalStatus.SETTLED,
      canonicalOutcome: CanonicalOutcome.RECIPIENT_FALLBACK,
    });
    expect(fallback.canonicalOutcome).toBe(CanonicalOutcome.RECIPIENT_FALLBACK);
    expect(isLpExposed(fallback)).toBe(false);
  });
});
