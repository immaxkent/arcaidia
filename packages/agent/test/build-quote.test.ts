import { describe, expect, it } from 'vitest';
import { DecisionReason, Verdict } from '@arcaidia/domain';
import { InvalidQuoteRequestError, buildQuote, DEFAULT_RISK_POLICY } from '../src/index.js';
import { ARC, NOW, SEPOLIA, USDC, health, vault } from './fixtures.js';
import { FakeObservationProvider } from './solver-fakes.js';

function deps(overrides: { vault?: ReturnType<typeof vault>; health?: ReturnType<typeof health> } = {}) {
  const observation = new FakeObservationProvider(overrides.vault ?? vault(), overrides.health ?? health());
  return { observation, policy: DEFAULT_RISK_POLICY, clock: () => NOW };
}

const REQUEST = {
  amount: USDC(1_000),
  maxFeeBps: 100,
  sourceChainId: SEPOLIA,
  destinationChainId: ARC,
};

describe('buildQuote', () => {
  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('returns an ACCEPT estimate for a well-formed request against a healthy vault', async () => {
    const quote = await buildQuote(REQUEST, deps());

    expect(quote.verdict).toBe(Verdict.ACCEPT);
    expect(quote.reason).toBe(DecisionReason.ACCEPTED);
    expect(quote.outputAmount).toBeGreaterThan(0n);
    expect(quote.outputAmount).toBeLessThan(REQUEST.amount);
    expect(quote.estimatedUnderAssumption).toBe(true);
  });

  it('reads live vault state for the requested destination chain, not a hardcoded one', async () => {
    const richVault = vault({ chainId: ARC, totalBalance: USDC(500_000), totalShares: USDC(500_000) });
    const d = deps({ vault: richVault });

    const quote = await buildQuote(REQUEST, d);

    expect(quote.inputsUsed.availableLiquidity).toBe(
      richVault.totalBalance - richVault.reserveFloor,
    );
  });

  it('assumes the required confirmation threshold is met, since nothing has been submitted yet', async () => {
    // A vault fixture healthy enough that confirmations are the only thing
    // that could refuse it — if the assumption were "0 confirmations" this
    // would come back REJECT/INSUFFICIENT_CONFIRMATIONS instead.
    const quote = await buildQuote(REQUEST, deps());
    expect(quote.reason).not.toBe(DecisionReason.INSUFFICIENT_CONFIRMATIONS);
  });

  it('every field evaluateIntent does not price on is a stable placeholder, not fabricated real data', async () => {
    const first = await buildQuote(REQUEST, deps());
    const second = await buildQuote(REQUEST, deps());
    expect(first.intentId).toBe(second.intentId);
    expect(first.intentId).toBe(`0x${'0'.repeat(64)}`);
  });

  // -----------------------------------------------------------------------
  // Refusal branches — the same reasons a real submission would hit
  // -----------------------------------------------------------------------

  it('refuses when the vault is paused', async () => {
    const quote = await buildQuote(REQUEST, deps({ vault: vault({ paused: true }) }));
    expect(quote.verdict).toBe(Verdict.PAUSE);
    expect(quote.reason).toBe(DecisionReason.VAULT_PAUSED);
  });

  it('refuses when settlement transport is unavailable', async () => {
    const quote = await buildQuote(REQUEST, deps({ health: health({ transport: 'UNAVAILABLE' }) }));
    expect(quote.verdict).toBe(Verdict.PAUSE);
    expect(quote.reason).toBe(DecisionReason.SETTLEMENT_TRANSPORT_UNAVAILABLE);
  });

  it('refuses when the amount exceeds available liquidity', async () => {
    const thin = vault({ totalBalance: USDC(500), totalShares: USDC(500), reserveFloor: 0n });
    const quote = await buildQuote(REQUEST, deps({ vault: thin }));
    expect(quote.verdict).toBe(Verdict.REJECT);
  });

  it("refuses when the priced fee exceeds the request's own maxFeeBps ceiling", async () => {
    const quote = await buildQuote({ ...REQUEST, maxFeeBps: 0 }, deps());
    expect(quote.verdict).toBe(Verdict.REJECT);
    expect(quote.reason).toBe(DecisionReason.FEE_CEILING_EXCEEDED);
  });

  it('refuses when outstanding exposure is already at the policy cap', async () => {
    const saturated = vault({ outstandingExposure: DEFAULT_RISK_POLICY.maxOutstandingExposure });
    const quote = await buildQuote(REQUEST, deps({ vault: saturated }));
    expect(quote.verdict).toBe(Verdict.REJECT);
    expect(quote.reason).toBe(DecisionReason.EXPOSURE_CAP_BREACH);
  });

  // -----------------------------------------------------------------------
  // Malformed requests — never reach evaluateIntent at all
  // -----------------------------------------------------------------------

  it('rejects a zero amount before touching the observation provider', async () => {
    const d = deps();
    await expect(buildQuote({ ...REQUEST, amount: 0n }, d)).rejects.toThrow(InvalidQuoteRequestError);
    expect(d.observation.vaultStateCalls).toBe(0);
  });

  it('rejects a negative amount', async () => {
    await expect(buildQuote({ ...REQUEST, amount: -1n }, deps())).rejects.toThrow(InvalidQuoteRequestError);
  });

  it('rejects a maxFeeBps outside 0-10000', async () => {
    await expect(buildQuote({ ...REQUEST, maxFeeBps: 10_001 }, deps())).rejects.toThrow(
      InvalidQuoteRequestError,
    );
    await expect(buildQuote({ ...REQUEST, maxFeeBps: -1 }, deps())).rejects.toThrow(
      InvalidQuoteRequestError,
    );
  });

  it('rejects identical source and destination chains', async () => {
    await expect(
      buildQuote({ ...REQUEST, destinationChainId: REQUEST.sourceChainId }, deps()),
    ).rejects.toThrow(InvalidQuoteRequestError);
  });
});
