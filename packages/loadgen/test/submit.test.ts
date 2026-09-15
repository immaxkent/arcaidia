import { describe, expect, it } from 'vitest';
import { MIN_INTENT_AMOUNT } from '../src/submit.js';

/**
 * The clamp itself is one expression in `ViemIntentSubmitter.submit` and needs a chain to test
 * end to end; what is worth pinning here is the rule it applies, because getting it wrong either
 * burns gas on a certain revert or sends dust.
 */
function clamp(planned: bigint, held: bigint): bigint | 'skip' {
  const affordable = (held * 9_000n) / 10_000n;
  if (planned <= affordable) return planned;
  return affordable < MIN_INTENT_AMOUNT ? 'skip' : affordable;
}

describe('sizing an intent against the wallet that sends it', () => {
  it('sends the planned amount when the wallet covers it', () => {
    expect(clamp(300_000_000n, 400_000_000n)).toBe(300_000_000n);
  });

  it('clamps to 90% of the balance when it does not, keeping something back for the next one', () => {
    expect(clamp(300_000_000n, 152_000_000n)).toBe(136_800_000n);
  });

  it('skips rather than sending dust', () => {
    expect(clamp(300_000_000n, 900_000n)).toBe('skip');
    expect(clamp(300_000_000n, 1_200_000n)).toBe(1_080_000n);
  });
});
