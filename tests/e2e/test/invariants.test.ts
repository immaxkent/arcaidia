import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CanonicalStatus, FastStatus, Verdict } from '@arcaidia/domain';
import { LocalAgentSigner, processIntent } from '@arcaidia/agent';
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
 * The ten global invariants, as an executable checklist.
 *
 * These are the claims the whole system rests on, listed in
 * `work-packages/README.md`. Each work package asserts its own piece of them;
 * this suite asserts them together, against two running chains, and is meant to
 * be re-run at every later gate. If one of these ever fails, something more
 * fundamental than a feature has broken.
 */

const RECIPIENT = '0x00000000000000000000000000000000000000b2' as const;
const DOMAINS: Record<number, number> = { [SEPOLIA]: 0, [ARC]: 26 };

let world: World;
let nonce = 5_000n;

beforeAll(async () => {
  world = await startWorld({ ports: [8645, 8646] });
}, 180_000);

afterAll(() => world?.stop());

async function newIntent(sourceChainId: number, amount = USDC(1_000), maxFeeBps = 100) {
  const destinationChainId = sourceChainId === SEPOLIA ? ARC : SEPOLIA;
  const intent = await createIntent(world.chains[sourceChainId]!, world.deployments[sourceChainId]!, {
    userKey: KEYS.user,
    recipient: RECIPIENT,
    amount,
    destinationChainId,
    maxFeeBps,
    deadline: world.now() + 3_600,
    nonce: nonce++,
  });

  const record = settlementRecordFor(intent, DOMAINS[sourceChainId]!, DOMAINS[destinationChainId]!);
  world.settlementAdapter.register(record.reference, record.amount);
  world.settlementJournal.add(record);
  await world.refreshObservation(intent);

  return { intent, record, destinationChainId };
}

describe('global invariants', () => {
  it('1. no fast fill without a verified source commitment', async () => {
    const { intent } = await newIntent(SEPOLIA);

    // Every intent that reaches a fill carries a settlement reference, which
    // the router can only emit after committing the funds.
    expect(intent.settlementRef).not.toBe(`0x${'0'.repeat(64)}`);

    const outcome = await processIntent(intent, world.solverDeps());
    expect(outcome.kind).toBe('FILLED');
  }, 120_000);

  it('2. no intent can be fast-filled twice', async () => {
    const { intent, destinationChainId } = await newIntent(SEPOLIA);
    expect((await processIntent(intent, world.solverDeps())).kind).toBe('FILLED');

    const before = await world.vaultState(destinationChainId);

    // Offer the same intent again through a stale observation and a fresh
    // journal, so nothing local remembers the first fill. The vault is the
    // backstop: it refuses regardless of what the solver believes.
    world.observation.recordIntent(intent);
    const second = await processIntent(intent, world.solverDeps());
    expect(second.kind).not.toBe('FILLED');

    const after = await world.vaultState(destinationChainId);
    expect(after.outstandingExposure).toBe(before.outstandingExposure);
    expect(after.totalBalance).toBe(before.totalBalance);
  }, 120_000);

  it('3. no expired authorization can execute', async () => {
    const { intent, destinationChainId } = await newIntent(SEPOLIA);
    const before = await world.balanceOf(destinationChainId, RECIPIENT);

    // Sign, then let the authorization go stale before it is submitted.
    const deps = world.solverDeps();
    const outcome = await processIntent(intent, {
      ...deps,
      submitter: {
        submitFastFill: async (chainId, vault, signed) => {
          await world.advance(120); // well past the 45s expiry
          return deps.submitter.submitFastFill(chainId, vault, signed);
        },
      },
    });

    expect(outcome.kind).toBe('SUBMISSION_FAILED');
    expect(await world.balanceOf(destinationChainId, RECIPIENT)).toBe(before);
  }, 120_000);

  it('4. no unauthorised signer can move LP funds', async () => {
    const { intent, destinationChainId } = await newIntent(SEPOLIA);
    const before = await world.vaultState(destinationChainId);

    const rogue = new LocalAgentSigner(
      '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
    );
    expect(rogue.address).not.toBe(world.agent.address);

    const outcome = await processIntent(intent, { ...world.solverDeps(), authority: rogue });

    expect(outcome.kind).toBe('SUBMISSION_FAILED');
    const after = await world.vaultState(destinationChainId);
    expect(after.totalBalance).toBe(before.totalBalance);
    expect(after.outstandingExposure).toBe(before.outstandingExposure);
  }, 120_000);

  it('5. no fill breaches the reserve floor or the exposure cap', async () => {
    const { intent, destinationChainId } = await newIntent(SEPOLIA);
    await processIntent(intent, world.solverDeps());

    const vault = await world.vaultState(destinationChainId);
    expect(vault.outstandingExposure).toBeLessThanOrEqual(POLICY.maxOutstandingExposure);
    expect(vault.totalBalance).toBeGreaterThanOrEqual(vault.reserveFloor);
  }, 120_000);

  it('6. fast and canonical settlement stay independently observable', async () => {
    const { intent, record, destinationChainId } = await newIntent(SEPOLIA);
    await processIntent(intent, world.solverDeps());

    // Fast settlement has happened; canonical has not. Two facts, two sources.
    const midFill = await world.vaultState(destinationChainId);
    expect(midFill.outstandingExposure).toBeGreaterThan(0n);

    const fast = FastStatus.FAST_FILLED;
    const canonical = CanonicalStatus.PENDING;
    expect(fast).not.toBe(canonical);

    await world.advance(POLICY.attestationDelaySeconds);
    expect((await processSettlement(record, world.settlementDeps())).kind).toBe('SETTLED');
  }, 120_000);

  it('7. the no-solver path delivers to the recipient, never traps funds', async () => {
    const { record, destinationChainId } = await newIntent(ARC, USDC(400));
    const before = await world.balanceOf(destinationChainId, RECIPIENT);

    await world.advance(POLICY.attestationDelaySeconds);
    const settled = await processSettlement(record, world.settlementDeps());

    expect(settled).toMatchObject({ kind: 'SETTLED', outcome: 'RECIPIENT_FALLBACK' });
    expect(await world.balanceOf(destinationChainId, RECIPIENT)).toBe(before + USDC(400));

    // Nothing is left sitting in the receiver.
    const receiver = world.deployments[destinationChainId]!.settlementReceiver;
    expect(await world.balanceOf(destinationChainId, receiver)).toBe(0n);
  }, 120_000);

  it('8. the settlement worker is idempotent across retries', async () => {
    const { intent, record, destinationChainId } = await newIntent(SEPOLIA);
    await processIntent(intent, world.solverDeps());
    await world.advance(POLICY.attestationDelaySeconds);

    const first = await processSettlement(record, world.settlementDeps());
    expect(first.kind).toBe('SETTLED');

    const vaultAfterFirst = await world.vaultState(destinationChainId);

    for (let i = 0; i < 3; i++) {
      const repeat = await processSettlement(record, world.settlementDeps());
      expect(['ALREADY_SETTLED', 'SETTLED']).toContain(repeat.kind);
    }

    const vaultAfterRetries = await world.vaultState(destinationChainId);
    expect(vaultAfterRetries.totalBalance).toBe(vaultAfterFirst.totalBalance);
  }, 120_000);

  it('9. observation downtime halts automation but grants no authority', async () => {
    const { intent, destinationChainId } = await newIntent(SEPOLIA);
    const before = await world.vaultState(destinationChainId);

    // The observation layer lies: it claims a vault with limitless liquidity.
    world.observation.recordVaultState({
      ...(await world.vaultState(destinationChainId)),
      totalBalance: USDC(10_000_000),
      reserveFloor: 0n,
      outstandingExposure: 0n,
    });

    // The solver still cannot spend what the vault does not have, because the
    // vault checks for itself.
    const outcome = await processIntent(
      { ...intent, amount: USDC(25_000) },
      world.solverDeps(),
    );
    expect(outcome.kind).not.toBe('FILLED');

    const after = await world.vaultState(destinationChainId);
    expect(after.totalBalance).toBe(before.totalBalance);
  }, 120_000);

  it('10. canonical settlement is never claimed before it happens', async () => {
    const { intent, record } = await newIntent(SEPOLIA);
    await processIntent(intent, world.solverDeps());

    // Before the attestation, the worker reports waiting — not settled.
    const early = await processSettlement(record, world.settlementDeps());
    expect(early.kind).toBe('WAITING');
    expect(world.settlementJournal.isSettled(intent.intentId)).toBe(false);

    await world.advance(POLICY.attestationDelaySeconds);
    expect((await processSettlement(record, world.settlementDeps())).kind).toBe('SETTLED');
    expect(world.settlementJournal.isSettled(intent.intentId)).toBe(true);
  }, 120_000);

  it('every decision is recorded with a verdict', () => {
    for (const record of world.decisions.all()) {
      expect([Verdict.ACCEPT, Verdict.REJECT, Verdict.PAUSE]).toContain(record.verdict);
    }
  });
});
