import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeIntentHook, feeBpsAt, type Address, type Hex } from '@arcaidia/domain';
import { processIntent } from '@arcaidia/agent';
import { processSettlement } from '@arcaidia/settlement';
import {
  ARC,
  KEYS,
  POLICY,
  SEPOLIA,
  USDC,
  createIntent,
  settlementRecordFor,
  startWorld,
  type World,
  type WorldVault,
} from '../src/index.js';

/**
 * WP-29: the v2 economy on two anvil chains — heterogeneous factory vaults, independent
 * solvers racing, on-chain fee tiers and ceilings, exhaustion and recovery, trade-intent
 * fallback, and canonical settlement from attested bytes. Every balance asserted, nothing
 * fabricated: the vault's own `currentFeeBps()` is read back from the chain at every step.
 */

const DOMAINS: Record<number, number> = { [SEPOLIA]: 0, [ARC]: 26 };
const RECIPIENT = '0x00000000000000000000000000000000000000C3' as const;

/** The plan's proposed House-style tiers: 10/25/60/120 bps at 50/75/90%. */
const TIERED = {
  baseFeeBps: 10,
  midFeeBps: 25,
  highFeeBps: 60,
  criticalFeeBps: 120,
  midThresholdBps: 5_000,
  highThresholdBps: 7_500,
  criticalThresholdBps: 9_000,
};

let world: World;
let vaultB: Record<number, WorldVault>;
let nonce = 9_000n;

beforeAll(async () => {
  world = await startWorld({ ports: [8745, 8746] });
  // A small, independently owned vault on each chain — different capital, different curve
  // from the House Vault (100k, permissive), its own owner, its own solver key.
  vaultB = {};
  for (const chainId of [SEPOLIA, ARC]) {
    vaultB[chainId] = await world.addVault({
      chainId,
      ownerKey: KEYS.ownerB,
      signerKey: KEYS.agentB,
      label: 'Vault B',
      capital: USDC(10_000),
      feePolicy: TIERED,
    });
  }
}, 240_000);

afterAll(() => world?.stop());

async function newIntent(
  sourceChainId: number,
  amount: bigint,
  maxFeeBps = 100,
  trade: { tokenOut: Address; targetMinOut: bigint } | null = null,
) {
  const destinationChainId = sourceChainId === SEPOLIA ? ARC : SEPOLIA;
  const intent = await createIntent(world.chains[sourceChainId]!, world.deployments[sourceChainId]!, {
    userKey: KEYS.user,
    recipient: RECIPIENT,
    amount,
    destinationChainId,
    maxFeeBps,
    deadline: world.now() + 3_600,
    nonce: nonce++,
    ...(trade ?? {}),
  });
  const record = settlementRecordFor(intent, DOMAINS[sourceChainId]!, DOMAINS[destinationChainId]!);
  world.settlementAdapter.register(record.reference, record.amount);
  world.settlementJournal.add(record);
  await world.refreshObservation(intent);
  await vaultB[destinationChainId]!.refresh(intent);
  return { intent, record, destinationChainId };
}

async function settleCanonically(record: ReturnType<typeof settlementRecordFor>) {
  await world.advance(POLICY.attestationDelaySeconds);
  return processSettlement(record, world.settlementDeps());
}

describe('two independent vaults race the same intent', () => {
  it.each([
    ['ethereum to arc, House first', SEPOLIA, 'house'],
    ['arc to ethereum, Vault B first', ARC, 'b'],
  ])('%s: exactly one fill, and settlement reimburses the winner only', async (_label, source, first) => {
    const { intent, record, destinationChainId } = await newIntent(source, USDC(1_000));
    const b = vaultB[destinationChainId]!;
    const recipientBefore = await world.balanceOf(destinationChainId, RECIPIENT);
    const houseBefore = await world.vaultState(destinationChainId);
    const bBefore = await b.state();

    const order = first === 'house' ? [world.solverDeps(), b.solverDeps()] : [b.solverDeps(), world.solverDeps()];
    const [winner, loser] = await Promise.all([processIntent(intent, order[0]!), Promise.resolve(null)]).then(
      async ([w]) => [w, await processIntent(intent, order[1]!)] as const,
    );

    // Both solvers were independently willing (both observed an open intent and had the
    // liquidity); the market let exactly one of them through.
    expect(winner.kind).toBe('FILLED');
    expect(loser.kind).toBe('SUBMISSION_FAILED');
    if (winner.kind !== 'FILLED') throw new Error(winner.kind);
    expect(await world.balanceOf(destinationChainId, RECIPIENT)).toBe(recipientBefore + winner.decision.outputAmount);

    const houseAfter = await world.vaultState(destinationChainId);
    const bAfter = await b.state();
    if (first === 'house') {
      expect(houseAfter.outstandingExposure).toBe(houseBefore.outstandingExposure + winner.decision.outputAmount);
      expect(bAfter.outstandingExposure).toBe(bBefore.outstandingExposure);
    } else {
      expect(bAfter.outstandingExposure).toBe(bBefore.outstandingExposure + winner.decision.outputAmount);
      expect(houseAfter.outstandingExposure).toBe(houseBefore.outstandingExposure);
    }

    // Canonical settlement reimburses whichever vault actually won.
    expect(await settleCanonically(record)).toMatchObject({ kind: 'SETTLED', outcome: 'LP_REIMBURSED' });
    const houseFinal = await world.vaultState(destinationChainId);
    const bFinal = await b.state();
    expect(houseFinal.outstandingExposure).toBe(houseBefore.outstandingExposure);
    expect(bFinal.outstandingExposure).toBe(bBefore.outstandingExposure);
  }, 180_000);
});

describe("the user's ceiling binds every solver", () => {
  it('a maxFeeBps below every vault tier is filled by nobody and settles canonically to the recipient', async () => {
    const { intent, record, destinationChainId } = await newIntent(SEPOLIA, USDC(800), 1);
    const recipientBefore = await world.balanceOf(destinationChainId, RECIPIENT);

    for (const deps of [world.solverDeps(), vaultB[destinationChainId]!.solverDeps()]) {
      const outcome = await processIntent(intent, deps);
      expect(outcome.kind).toBe('DECLINED');
      if (outcome.kind === 'DECLINED') expect(outcome.decision.reason).toBe('FEE_CEILING_EXCEEDED');
    }

    expect(await settleCanonically(record)).toMatchObject({ kind: 'SETTLED', outcome: 'RECIPIENT_FALLBACK' });
    expect(await world.balanceOf(destinationChainId, RECIPIENT)).toBe(recipientBefore + USDC(800));
  }, 180_000);
});

describe("Vault B's posted tier rises with utilisation, and binds", () => {
  const filledRecords: ReturnType<typeof settlementRecordFor>[] = [];

  /// Utilisation is exposure / (LP cash + exposure). Three 3,100 USDC fills against 10,000
  /// of capital: the tier *posted before each fill* is 10 (0%), 10 (~31%), 25 (~62%), and
  /// afterwards ~93% is utilised — the critical tier is posted. Each fill is priced at the
  /// tier the chain reported at that moment, never at the solver's own idea of a price.
  it('three fills walk the posted tier up, each priced at the chain-reported tier', async () => {
    const b = vaultB[ARC]!;
    const expectedTiers = [10, 10, 25];

    for (const expectedTier of expectedTiers) {
      const before = await b.state();
      expect(before.currentFeeBps).toBe(expectedTier);
      expect(before.currentFeeBps).toBe(feeBpsAt(before.feePolicy, Number((before.outstandingExposure * 10_000n) / (before.totalBalance - before.accruedProtocolFees + before.outstandingExposure))));

      const { intent, record } = await newIntent(SEPOLIA, USDC(3_100), 150);
      const outcome = await processIntent(intent, b.solverDeps());
      expect(outcome.kind).toBe('FILLED');
      if (outcome.kind !== 'FILLED') throw new Error(outcome.kind);
      expect(outcome.decision.feeBps).toBe(expectedTier);
      expect(outcome.decision.inputsUsed.vaultFeeBps).toBe(expectedTier);
      filledRecords.push(record);
      b.observation.markFilled(intent.intentId);
      world.observation.markFilled(intent.intentId);
    }
    // ~9,275 advanced against 10,000: ~93% utilised — the critical tier is now posted.
    expect((await b.state()).currentFeeBps).toBe(120);
  }, 240_000);

  it('then liquidity is exhausted: the next intent gets no fast fill and falls back to CCTP', async () => {
    const b = vaultB[ARC]!;
    const { intent, record } = await newIntent(SEPOLIA, USDC(3_100), 150);
    const recipientBefore = await world.balanceOf(ARC, RECIPIENT);

    const outcome = await processIntent(intent, b.solverDeps());
    expect(outcome.kind).toBe('DECLINED');
    if (outcome.kind === 'DECLINED') expect(outcome.decision.reason).toBe('INSUFFICIENT_LIQUIDITY');

    expect(await settleCanonically(record)).toMatchObject({ kind: 'SETTLED', outcome: 'RECIPIENT_FALLBACK' });
    expect(await world.balanceOf(ARC, RECIPIENT)).toBe(recipientBefore + USDC(3_100));
  }, 180_000);

  it('canonical reimbursement restores liquidity, the tier falls back, and fills resume', async () => {
    const b = vaultB[ARC]!;
    for (const record of filledRecords) {
      expect(await settleCanonically(record)).toMatchObject({ kind: 'SETTLED', outcome: 'LP_REIMBURSED' });
    }
    const restored = await b.state();
    expect(restored.outstandingExposure).toBe(0n);
    expect(restored.currentFeeBps).toBe(10);
    expect(restored.totalBalance).toBeGreaterThan(USDC(10_000)); // the fees came home

    const { intent } = await newIntent(SEPOLIA, USDC(3_100), 150);
    const outcome = await processIntent(intent, b.solverDeps());
    expect(outcome.kind).toBe('FILLED');
    if (outcome.kind === 'FILLED') expect(outcome.decision.feeBps).toBe(10);
  }, 240_000);
});

describe('trade intents (D9)', () => {
  let tokenOut: Address;

  beforeAll(async () => {
    tokenOut = await world.deployMockToken(ARC);
  });

  it('without an adapter the solver declines and canonical settlement delivers USDC — nothing stranded', async () => {
    const { intent, record } = await newIntent(SEPOLIA, USDC(500), 100, { tokenOut, targetMinOut: 1n });
    const recipientUsdcBefore = await world.balanceOf(ARC, RECIPIENT);

    const outcome = await processIntent(intent, world.solverDeps());
    expect(outcome.kind).toBe('DECLINED');
    if (outcome.kind === 'DECLINED') expect(outcome.decision.reason).toBe('TRADE_NOT_SUPPORTED');

    expect(await settleCanonically(record)).toMatchObject({ kind: 'SETTLED', outcome: 'RECIPIENT_FALLBACK' });
    expect(await world.balanceOf(ARC, RECIPIENT)).toBe(recipientUsdcBefore + USDC(500));
    expect(await world.erc20BalanceOf(ARC, tokenOut, RECIPIENT)).toBe(0n);
  }, 180_000);

  it('with an adapter on the vault and one in the solver, the recipient receives tokenOut', async () => {
    const adapter = await world.deployMockSwapAdapter(ARC, tokenOut, 4n * 10n ** 17n); // 1 USDC -> 0.4 units
    await world.setHouseSwapAdapter(ARC, adapter);

    const { intent, record } = await newIntent(SEPOLIA, USDC(500), 100, { tokenOut, targetMinOut: 1n });
    const recipientUsdcBefore = await world.balanceOf(ARC, RECIPIENT);
    const houseBefore = await world.vaultState(ARC);

    const outcome = await processIntent(intent, {
      ...world.solverDeps(),
      swapAdapter: { async quote() { return 1n; }, async canSatisfy() { return true; } },
    });
    expect(outcome.kind).toBe('FILLED');
    if (outcome.kind !== 'FILLED') throw new Error(outcome.kind);

    // tokenOut delivered, no USDC delivered — and the vault's receivable is the USDC that left.
    expect(await world.erc20BalanceOf(ARC, tokenOut, RECIPIENT)).toBe((outcome.decision.outputAmount * 4n) / 10n);
    expect(await world.balanceOf(ARC, RECIPIENT)).toBe(recipientUsdcBefore);
    expect((await world.vaultState(ARC)).outstandingExposure).toBe(houseBefore.outstandingExposure + outcome.decision.outputAmount);

    // Canonical settlement reimburses in USDC exactly as for a plain transfer.
    expect(await settleCanonically(record)).toMatchObject({ kind: 'SETTLED', outcome: 'LP_REIMBURSED' });
    expect((await world.vaultState(ARC)).outstandingExposure).toBe(houseBefore.outstandingExposure);
  }, 180_000);
});

describe('settlement from attested bytes (D8)', () => {
  it('routes an unfilled intent to the recipient named in the hook, and a hook for another intent settles only that one', async () => {
    const { intent: a } = await newIntent(SEPOLIA, USDC(700), 100);
    const { intent: b } = await newIntent(SEPOLIA, USDC(300), 100);
    const recipientBefore = await world.balanceOf(ARC, RECIPIENT);

    // A's message, submitted by the worker's client — permissionless, no reporter assertion.
    const proofA = await world.cctpMessage(ARC, {
      nonce: `0x${'a1'.repeat(32)}` as Hex,
      amount: USDC(700),
      hookData: encodeIntentHook({ intentId: a.intentId, recipient: RECIPIENT }),
    });
    const settled = await world.settleWithProof(ARC, proofA.message, proofA.attestation);
    expect(settled.outcome).toBe('RECIPIENT_FALLBACK');
    expect(await world.balanceOf(ARC, RECIPIENT)).toBe(recipientBefore + USDC(700));
    expect(await world.isSettled(ARC, a.intentId)).toBe(true);
    expect(await world.isSettled(ARC, b.intentId)).toBe(false);

    // A message whose hook names B settles B — never A again, never anything else.
    const proofB = await world.cctpMessage(ARC, {
      nonce: `0x${'b2'.repeat(32)}` as Hex,
      amount: USDC(300),
      hookData: encodeIntentHook({ intentId: b.intentId, recipient: RECIPIENT }),
    });
    await world.settleWithProof(ARC, proofB.message, proofB.attestation);
    expect(await world.isSettled(ARC, b.intentId)).toBe(true);
    expect(await world.balanceOf(ARC, RECIPIENT)).toBe(recipientBefore + USDC(1_000));

    // A late fast fill of A is now impossible: the vault checks the receiver first.
    const late = await processIntent(a, world.solverDeps());
    expect(late.kind).not.toBe('FILLED');
  }, 180_000);

  it('a message minted elsewhere or with a forged attestation is refused', async () => {
    const { intent } = await newIntent(SEPOLIA, USDC(100), 100);
    const elsewhere = await world.cctpMessage(ARC, {
      nonce: `0x${'c3'.repeat(32)}` as Hex,
      amount: USDC(100),
      hookData: encodeIntentHook({ intentId: intent.intentId, recipient: RECIPIENT }),
      mintRecipient: '0x000000000000000000000000000000000000dEaD',
    });
    await expect(world.settleWithProof(ARC, elsewhere.message, elsewhere.attestation)).rejects.toThrow();

    const genuine = await world.cctpMessage(ARC, {
      nonce: `0x${'d4'.repeat(32)}` as Hex,
      amount: USDC(100),
      hookData: encodeIntentHook({ intentId: intent.intentId, recipient: RECIPIENT }),
    });
    await expect(world.settleWithProof(ARC, genuine.message, `0x${'00'.repeat(32)}`)).rejects.toThrow();
    expect(await world.isSettled(ARC, intent.intentId)).toBe(false);
  }, 120_000);
});
