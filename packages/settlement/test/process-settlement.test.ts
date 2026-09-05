import { beforeEach, describe, expect, it } from 'vitest';
import { SettlementStatus } from '@arcaidia/domain';
import {
  InMemorySettlementJournal,
  MockSettlementAdapter,
  processSettlement,
  runSettlementPass,
  type SettlementDependencies,
  type SettlementRecord,
} from '../src/index.js';
import { ARC, SEPOLIA, TestClock, USDC, mirroredReference, reference } from './fixtures.js';
import { FakeReceiverClient } from './worker-fakes.js';

const DELAY = 120;
const ARC_RECEIVER = '0x6666666666666666666666666666666666666666' as const;
const SEPOLIA_RECEIVER = '0x3333333333333333333333333333333333333333' as const;
const RECIPIENT = '0x2222222222222222222222222222222222222222' as const;

describe('processSettlement', () => {
  let clock: TestClock;
  let adapter: MockSettlementAdapter;
  let receiverClient: FakeReceiverClient;
  let journal: InMemorySettlementJournal;
  let deps: SettlementDependencies;

  const record = (seed: number, mirrored = false): SettlementRecord => ({
    reference: mirrored ? mirroredReference(seed) : reference(seed),
    amount: USDC(1_000),
    fallbackRecipient: RECIPIENT,
  });

  beforeEach(() => {
    clock = new TestClock();
    adapter = new MockSettlementAdapter({ attestationDelaySeconds: DELAY, clock: clock.now });
    receiverClient = new FakeReceiverClient();
    journal = new InMemorySettlementJournal();

    deps = {
      adapter,
      receivers: new Map([
        [ARC, ARC_RECEIVER],
        [SEPOLIA, SEPOLIA_RECEIVER],
      ]),
      receiverClient,
      journal,
      clock: clock.now,
    };
  });

  const track = (r: SettlementRecord) => {
    adapter.register(r.reference, r.amount);
    journal.add(r);
    return r;
  };

  // -----------------------------------------------------------------------
  // Waiting
  // -----------------------------------------------------------------------

  it('waits while the attestation is pending', async () => {
    const r = track(record(1));

    const outcome = await processSettlement(r, deps);

    expect(outcome).toEqual({ kind: 'WAITING', status: SettlementStatus.PENDING_ATTESTATION });
    expect(receiverClient.settleCalls).toHaveLength(0);
  });

  it('does not mark a waiting settlement as done', async () => {
    const r = track(record(2));
    await processSettlement(r, deps);
    expect(journal.isSettled(r.reference.intentId)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // The reimbursement path
  // -----------------------------------------------------------------------

  it('reimburses the vault for a fast-filled intent', async () => {
    const r = track(record(3));
    receiverClient.filled.add(r.reference.intentId.toLowerCase());
    clock.advance(DELAY);

    const outcome = await processSettlement(r, deps);

    expect(outcome).toMatchObject({ kind: 'SETTLED', outcome: 'LP_REIMBURSED' });
    expect(journal.isSettled(r.reference.intentId)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // The fallback path
  // -----------------------------------------------------------------------

  /// The specification's central promise: without a solver, the user is still
  /// paid and nothing is trapped.
  it('pays the recipient when nobody fast-filled', async () => {
    const r = track(record(4));
    clock.advance(DELAY);

    const outcome = await processSettlement(r, deps);

    expect(outcome).toMatchObject({ kind: 'SETTLED', outcome: 'RECIPIENT_FALLBACK' });
    expect(receiverClient.settleCalls[0]).toMatchObject({
      recipient: RECIPIENT,
      amount: USDC(1_000),
    });
  });

  // -----------------------------------------------------------------------
  // Both directions
  // -----------------------------------------------------------------------

  it.each([
    ['ethereum to arc', false, ARC],
    ['arc to ethereum', true, SEPOLIA],
  ])('settles %s', async (_label, mirrored, destinationChainId) => {
    const r = track(record(5, mirrored as boolean));
    clock.advance(DELAY);

    const outcome = await processSettlement(r, deps);

    expect(outcome.kind).toBe('SETTLED');
    expect(r.reference.destinationChainId).toBe(destinationChainId);
  });

  it('fails clearly when no receiver is configured for the destination', async () => {
    const r = track(record(6));
    const outcome = await processSettlement(r, { ...deps, receivers: new Map() });

    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind === 'FAILED') expect(outcome.error.message).toMatch(/No settlement receiver/);
  });

  // -----------------------------------------------------------------------
  // Onchain state is authoritative
  // -----------------------------------------------------------------------

  /// The chain is asked before anything happens, every single time.
  it('asks the chain before touching the transport', async () => {
    const r = track(record(7));
    await processSettlement(r, deps);
    expect(receiverClient.isSettledCalls).toBe(1);
  });

  /// A restarted worker with an empty journal must not re-settle. Only the
  /// chain can answer that.
  it('reconciles to the chain when another party already settled', async () => {
    const r = track(record(8));
    receiverClient.settledOnchain.add(r.reference.intentId.toLowerCase());
    clock.advance(DELAY);

    const outcome = await processSettlement(r, deps);

    expect(outcome).toEqual({ kind: 'ALREADY_SETTLED' });
    expect(receiverClient.settleCalls).toHaveLength(0);
    expect(journal.isSettled(r.reference.intentId)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Idempotency and crash safety
  // -----------------------------------------------------------------------

  it('settles exactly once when stepped repeatedly', async () => {
    const r = track(record(9));
    clock.advance(DELAY);

    await processSettlement(r, deps);
    await processSettlement(r, deps);
    await processSettlement(r, deps);

    expect(receiverClient.settleCalls).toHaveLength(1);
  });

  /// Two workers on the same queue is an ordinary deployment, not an edge case.
  it('settles once when two workers race the same settlement', async () => {
    const r = track(record(10));
    clock.advance(DELAY);

    await Promise.all([processSettlement(r, deps), processSettlement(r, deps)]);

    expect(receiverClient.settleCalls.length).toBeLessThanOrEqual(1);
  });

  /// The crash case that matters: the transaction landed, the worker died
  /// before hearing about it, and its journal is gone. The next run must
  /// discover the truth from the chain rather than paying again.
  it('recovers when a settlement landed but the worker never saw it', async () => {
    const r = track(record(11));
    clock.advance(DELAY);

    receiverClient.failSettleWith = new Error('timeout');
    receiverClient.landDespiteFailure = true;

    const first = await processSettlement(r, deps);
    expect(first.kind).toBe('FAILED');
    expect(journal.isSettled(r.reference.intentId)).toBe(false);

    // Restart: fresh journal, same chain.
    const restarted = new InMemorySettlementJournal();
    restarted.add(r);
    receiverClient.failSettleWith = null;

    const second = await processSettlement(r, { ...deps, journal: restarted });

    expect(second).toEqual({ kind: 'ALREADY_SETTLED' });
    expect(receiverClient.settleCalls).toHaveLength(0);
  });

  it('leaves a settlement retryable after a genuine failure', async () => {
    const r = track(record(12));
    clock.advance(DELAY);

    receiverClient.failSettleWith = new Error('reverted');
    expect((await processSettlement(r, deps)).kind).toBe('FAILED');
    expect(journal.pending()).toHaveLength(1);

    receiverClient.failSettleWith = null;
    expect((await processSettlement(r, deps)).kind).toBe('SETTLED');
  });

  // -----------------------------------------------------------------------
  // Transport trouble
  // -----------------------------------------------------------------------

  it('reports the transport unavailable rather than failing the settlement', async () => {
    const r = track(record(13));
    adapter.setReachable(false);

    const outcome = await processSettlement(r, deps);

    expect(outcome.kind).toBe('TRANSPORT_UNAVAILABLE');
    expect(journal.pending()).toHaveLength(1);
  });

  it('retries through a transient completion failure', async () => {
    const r = track(record(14));
    clock.advance(DELAY);
    adapter.failNextCompletions(1);

    expect((await processSettlement(r, deps)).kind).toBe('TRANSPORT_UNAVAILABLE');
    expect((await processSettlement(r, deps)).kind).toBe('SETTLED');
  });

  it('does not settle when the chain cannot be read', async () => {
    const r = track(record(15));
    clock.advance(DELAY);
    receiverClient.failIsSettledWith = new Error('rpc down');

    expect((await processSettlement(r, deps)).kind).toBe('FAILED');
    expect(receiverClient.settleCalls).toHaveLength(0);
  });
});

describe('runSettlementPass', () => {
  it('advances every pending settlement and leaves settled ones alone', async () => {
    const clock = new TestClock();
    const adapter = new MockSettlementAdapter({ attestationDelaySeconds: DELAY, clock: clock.now });
    const receiverClient = new FakeReceiverClient();
    const journal = new InMemorySettlementJournal();

    const deps: SettlementDependencies = {
      adapter,
      receivers: new Map([[ARC, ARC_RECEIVER]]),
      receiverClient,
      journal,
      clock: clock.now,
    };

    for (const seed of [20, 21, 22]) {
      const r = { reference: reference(seed), amount: USDC(500), fallbackRecipient: RECIPIENT };
      adapter.register(r.reference, r.amount);
      journal.add(r);
    }

    const waiting = await runSettlementPass(deps);
    expect([...waiting.values()].every((o) => o.kind === 'WAITING')).toBe(true);

    clock.advance(DELAY);
    const settled = await runSettlementPass(deps);
    expect([...settled.values()].every((o) => o.kind === 'SETTLED')).toBe(true);

    // Nothing is left to do, so a third pass touches nothing.
    expect(journal.pending()).toHaveLength(0);
    expect((await runSettlementPass(deps)).size).toBe(0);
    expect(receiverClient.settleCalls).toHaveLength(3);
  });
});
