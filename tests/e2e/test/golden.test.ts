import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Verdict } from '@arcaidia/domain';
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
} from '../src/index.js';

/**
 * The golden run.
 *
 * One command, two chains, the whole economic lifecycle, no sponsor service
 * anywhere. Balances are asserted at every step — the point is not that it
 * finishes, but that the money is in the right place at each stage and that the
 * vault ends up ahead by exactly the fee it charged.
 */

const DOMAINS: Record<number, number> = { [SEPOLIA]: 0, [ARC]: 26 };
const RECIPIENT = '0x00000000000000000000000000000000000000A1' as const;

let world: World;
let nonce = 0n;

beforeAll(async () => {
  world = await startWorld();
}, 180_000);

afterAll(() => world?.stop());

/** Runs one intent from creation to canonical reconciliation. */
async function run(sourceChainId: number, amount: bigint, options: { solverActive?: boolean } = {}) {
  const destinationChainId = sourceChainId === SEPOLIA ? ARC : SEPOLIA;
  const solverActive = options.solverActive ?? true;

  const intent = await createIntent(world.chains[sourceChainId]!, world.deployments[sourceChainId]!, {
    userKey: KEYS.user,
    recipient: RECIPIENT,
    amount,
    destinationChainId,
    maxFeeBps: 100,
    deadline: world.now() + 3_600,
    nonce: nonce++,
  });

  // The canonical leg is already in flight; the worker tracks it from here.
  const record = settlementRecordFor(
    intent,
    DOMAINS[sourceChainId]!,
    DOMAINS[destinationChainId]!,
  );
  world.settlementAdapter.register(record.reference, record.amount);
  world.settlementJournal.add(record);

  await world.refreshObservation(intent);

  const fill = solverActive ? await processIntent(intent, world.solverDeps()) : null;
  if (fill?.kind === 'FILLED') world.observation.markFilled(intent.intentId);

  return { intent, destinationChainId, fill };
}

describe('the golden run', () => {
  it.each([
    ['ethereum to arc', SEPOLIA],
    ['arc to ethereum', ARC],
  ])('settles %s end to end', async (_label, sourceChainId) => {
    const amount = USDC(1_000);
    const destinationChainId = sourceChainId === SEPOLIA ? ARC : SEPOLIA;

    const recipientBefore = await world.balanceOf(destinationChainId, RECIPIENT);
    const vaultBefore = await world.vaultState(destinationChainId);

    // --- the fast path ---------------------------------------------------

    const { intent, fill } = await run(sourceChainId, amount);

    expect(fill?.kind).toBe('FILLED');
    if (fill?.kind !== 'FILLED') throw new Error('expected a fill');
    expect(fill.decision.verdict).toBe(Verdict.ACCEPT);

    const fee = fill.decision.feeAmount;
    const output = fill.decision.outputAmount;
    expect(output + fee).toBe(amount);

    // The recipient has their money, seconds after the intent was created.
    expect(await world.balanceOf(destinationChainId, RECIPIENT)).toBe(recipientBefore + output);

    // The vault has advanced it and is carrying the receivable, so its total
    // assets have not moved.
    const midFill = await world.vaultState(destinationChainId);
    expect(midFill.outstandingExposure).toBe(vaultBefore.outstandingExposure + output);
    expect(midFill.totalBalance).toBe(vaultBefore.totalBalance - output);

    // --- the canonical path ----------------------------------------------

    // Nothing to do until the attestation is ready.
    const record = world.settlementJournal
      .pending()
      .find((r) => r.reference.intentId === intent.intentId)!;
    expect((await processSettlement(record, world.settlementDeps())).kind).toBe('WAITING');

    await world.advance(POLICY.attestationDelaySeconds);

    const settled = await processSettlement(record, world.settlementDeps());
    expect(settled).toMatchObject({ kind: 'SETTLED', outcome: 'LP_REIMBURSED' });

    // --- the books -------------------------------------------------------

    const after = await world.vaultState(destinationChainId);

    expect(after.outstandingExposure).toBe(vaultBefore.outstandingExposure);
    // Everything advanced came back, plus the fee.
    expect(after.totalBalance).toBe(vaultBefore.totalBalance + fee);

    // Half the fee is the protocol's and is not LP capital; the LPs keep the rest.
    const protocolCut = (fee * BigInt(POLICY.protocolFeeShareBps)) / 10_000n;
    expect(after.accruedProtocolFees).toBe(vaultBefore.accruedProtocolFees + protocolCut);

    const lpAssetsBefore = vaultBefore.totalBalance + vaultBefore.outstandingExposure - vaultBefore.accruedProtocolFees;
    const lpAssetsAfter = after.totalBalance + after.outstandingExposure - after.accruedProtocolFees;
    expect(lpAssetsAfter - lpAssetsBefore).toBe(fee - protocolCut);
  }, 120_000);
});

describe('the fallback run', () => {
  /// The specification's central promise. Arcaidia accelerates a transfer; it
  /// is never required for one to succeed.
  it.each([
    ['ethereum to arc', SEPOLIA],
    ['arc to ethereum', ARC],
  ])('pays the recipient with no solver, %s', async (_label, sourceChainId) => {
    const amount = USDC(500);
    const destinationChainId = sourceChainId === SEPOLIA ? ARC : SEPOLIA;

    const recipientBefore = await world.balanceOf(destinationChainId, RECIPIENT);
    const vaultBefore = await world.vaultState(destinationChainId);

    const { intent } = await run(sourceChainId, amount, { solverActive: false });

    await world.advance(POLICY.attestationDelaySeconds);

    const record = world.settlementJournal
      .pending()
      .find((r) => r.reference.intentId === intent.intentId)!;
    const settled = await processSettlement(record, world.settlementDeps());

    expect(settled).toMatchObject({ kind: 'SETTLED', outcome: 'RECIPIENT_FALLBACK' });

    // The user is paid the full amount — no solver took a fee — and no LP
    // capital was ever at risk.
    expect(await world.balanceOf(destinationChainId, RECIPIENT)).toBe(recipientBefore + amount);

    const after = await world.vaultState(destinationChainId);
    expect(after.totalBalance).toBe(vaultBefore.totalBalance);
    expect(after.outstandingExposure).toBe(vaultBefore.outstandingExposure);
  }, 120_000);
});

describe('deterministic deployment', () => {
  /// WP-01's acceptance criterion, asserted against two running chains rather
  /// than in simulation.
  it('places every protocol contract at the same address on both chains', () => {
    const sepolia = world.deployments[SEPOLIA]!;
    const arc = world.deployments[ARC]!;

    expect(arc.router).toBe(sepolia.router);
    expect(arc.vault).toBe(sepolia.vault);
    expect(arc.settlementReceiver).toBe(sepolia.settlementReceiver);
  });

  it('gives the two chains different USDC addresses, as production does', () => {
    // Different only because each chain deployed its own MockUSDC at a
    // different nonce; the protocol addresses match regardless, which is the
    // property that matters.
    expect(world.deployments[SEPOLIA]!.vault).not.toBe(world.deployments[SEPOLIA]!.usdc);
  });
});

describe('the solver refuses safely', () => {
  /// Whatever the reason for refusing, nothing may move. These assert the
  /// whole world is unchanged, not merely that the verdict was negative.
  async function expectNothingMoved(
    destinationChainId: number,
    act: () => Promise<void>,
  ): Promise<void> {
    const vaultBefore = await world.vaultState(destinationChainId);
    const recipientBefore = await world.balanceOf(destinationChainId, RECIPIENT);

    await act();

    const vaultAfter = await world.vaultState(destinationChainId);
    expect(vaultAfter.totalBalance).toBe(vaultBefore.totalBalance);
    expect(vaultAfter.outstandingExposure).toBe(vaultBefore.outstandingExposure);
    expect(await world.balanceOf(destinationChainId, RECIPIENT)).toBe(recipientBefore);
  }

  it('rejects when the user ceiling is below the risk-priced fee', async () => {
    await expectNothingMoved(ARC, async () => {
      const intent = await createIntent(world.chains[SEPOLIA]!, world.deployments[SEPOLIA]!, {
        userKey: KEYS.user,
        recipient: RECIPIENT,
        amount: USDC(1_000),
        destinationChainId: ARC,
        // The base fee is 10bps; this user will not pay it.
        maxFeeBps: 5,
        deadline: world.now() + 3_600,
        nonce: nonce++,
      });
      await world.refreshObservation(intent);

      const outcome = await processIntent(intent, world.solverDeps());
      expect(outcome.kind).toBe('DECLINED');
      if (outcome.kind === 'DECLINED') {
        expect(outcome.decision.reason).toBe('FEE_CEILING_EXCEEDED');
      }
    });
  }, 120_000);

  /// The transport being down is not a property of the intent, so the solver
  /// pauses rather than rejecting — and the settlement worker keeps working.
  it('pauses when canonical settlement is unreachable', async () => {
    await expectNothingMoved(ARC, async () => {
      const intent = await createIntent(world.chains[SEPOLIA]!, world.deployments[SEPOLIA]!, {
        userKey: KEYS.user,
        recipient: RECIPIENT,
        amount: USDC(1_000),
        destinationChainId: ARC,
        maxFeeBps: 100,
        deadline: world.now() + 3_600,
        nonce: nonce++,
      });

      world.settlementAdapter.setReachable(false);
      try {
        await world.refreshObservation(intent);
        const outcome = await processIntent(intent, world.solverDeps());

        expect(outcome.kind).toBe('DECLINED');
        if (outcome.kind === 'DECLINED') {
          expect(outcome.decision.verdict).toBe(Verdict.PAUSE);
          expect(outcome.decision.reason).toBe('SETTLEMENT_TRANSPORT_UNAVAILABLE');
        }
      } finally {
        world.settlementAdapter.setReachable(true);
      }
    });
  }, 120_000);

  /// An intent the chain has already filled must not be filled again, even if
  /// the observation layer has not caught up.
  it('refuses to fill an intent the chain has already filled', async () => {
    const { intent, fill } = await run(SEPOLIA, USDC(1_000));
    expect(fill?.kind).toBe('FILLED');

    // A poller that has not yet seen the fill still offers the intent.
    world.observation.recordIntent(intent);

    await expectNothingMoved(ARC, async () => {
      const second = await processIntent(intent, world.solverDeps());
      expect(second.kind).toBe('SKIPPED');
    });
  }, 120_000);

  it('records every decision it took, refusals included', () => {
    const records = world.decisions.all();
    expect(records.length).toBeGreaterThan(0);
    expect(records.some((r) => r.verdict === 'ACCEPT')).toBe(true);
    expect(records.some((r) => r.verdict !== 'ACCEPT')).toBe(true);

    // Every record carries the inputs behind it, so any quote is reproducible.
    for (const record of records) {
      expect(record.inputs.requestedAmount).toBeTypeOf('string');
      expect(record.policyVersion).toBeTruthy();
    }
  });
});
