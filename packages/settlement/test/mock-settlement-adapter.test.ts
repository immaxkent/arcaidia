import { describe, expect, it, beforeEach } from 'vitest';
import { SettlementStatus } from '@arcaidia/domain';
import { MockSettlementAdapter } from '../src/index.js';
import { NOW, TestClock, USDC, mirroredReference, reference } from './fixtures.js';

const DELAY = 120;

describe('MockSettlementAdapter', () => {
  let clock: TestClock;
  let adapter: MockSettlementAdapter;

  beforeEach(() => {
    clock = new TestClock();
    adapter = new MockSettlementAdapter({ attestationDelaySeconds: DELAY, clock: clock.now });
  });

  // -----------------------------------------------------------------------
  // The attestation lifecycle
  // -----------------------------------------------------------------------

  it('starts pending attestation', async () => {
    const ref = reference(1);
    adapter.register(ref, USDC(1_000));

    const state = await adapter.status(ref);
    expect(state.status).toBe(SettlementStatus.PENDING_ATTESTATION);
    expect(state.amount).toBe(USDC(1_000));
  });

  it('stays pending right up to the delay', async () => {
    const ref = reference(2);
    adapter.register(ref, USDC(1_000));

    clock.advance(DELAY - 1);
    expect((await adapter.status(ref)).status).toBe(SettlementStatus.PENDING_ATTESTATION);
  });

  it('attests once the delay has elapsed', async () => {
    const ref = reference(3);
    adapter.register(ref, USDC(1_000));

    clock.advance(DELAY);
    expect((await adapter.status(ref)).status).toBe(SettlementStatus.ATTESTED);
  });

  /// The worker must not be able to force settlement early by asking twice.
  it('refuses to complete before attestation', async () => {
    const ref = reference(4);
    adapter.register(ref, USDC(1_000));

    await expect(adapter.complete(ref)).rejects.toThrow(/not ATTESTED/);
  });

  it('completes once attested and records a destination transaction', async () => {
    const ref = reference(5);
    adapter.register(ref, USDC(1_000));
    clock.advance(DELAY);

    const state = await adapter.complete(ref);
    expect(state.status).toBe(SettlementStatus.RECEIVED);
    expect(state.destinationTxHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  // -----------------------------------------------------------------------
  // Idempotency
  // -----------------------------------------------------------------------

  /// A worker that crashed after submitting and retried on restart must not
  /// double-pay. Returning the same state is what makes the retry safe.
  it('returns the same state when completed twice', async () => {
    const ref = reference(6);
    adapter.register(ref, USDC(1_000));
    clock.advance(DELAY);

    const first = await adapter.complete(ref);
    const second = await adapter.complete(ref);

    expect(second.status).toBe(SettlementStatus.RECEIVED);
    expect(second.destinationTxHash).toBe(first.destinationTxHash);
  });

  it('reports a completed message as no longer active', async () => {
    const ref = reference(7);
    adapter.register(ref, USDC(1_000));
    clock.advance(DELAY);

    expect(adapter.active()).toHaveLength(1);
    await adapter.complete(ref);
    adapter.markReconciled(ref.intentId);
    expect(adapter.active()).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Failure modes worth modelling
  // -----------------------------------------------------------------------

  /// Rate limits and timeouts are the ordinary weather of an attestation
  /// service, not an exceptional case.
  it('recovers from a transient completion failure', async () => {
    const ref = reference(8);
    adapter.register(ref, USDC(1_000));
    clock.advance(DELAY);

    adapter.failNextCompletions(2);
    await expect(adapter.complete(ref)).rejects.toThrow(/retry/);
    await expect(adapter.complete(ref)).rejects.toThrow(/retry/);

    const state = await adapter.complete(ref);
    expect(state.status).toBe(SettlementStatus.RECEIVED);
  });

  it('throws on every call while unreachable', async () => {
    const ref = reference(9);
    adapter.register(ref, USDC(1_000));
    adapter.setReachable(false);

    await expect(adapter.status(ref)).rejects.toThrow(/unreachable/);
    await expect(adapter.complete(ref)).rejects.toThrow(/unreachable/);
  });

  it('refuses to report on a message it never saw', async () => {
    await expect(adapter.status(reference(10))).rejects.toThrow(/No settlement registered/);
  });

  // -----------------------------------------------------------------------
  // Health — the risk engine's inputs
  // -----------------------------------------------------------------------

  it('reports healthy with nothing in flight', async () => {
    const health = await adapter.health();
    expect(health.transport).toBe('HEALTHY');
    expect(health.pendingValue).toBe(0n);
    expect(health.oldestUnsettledAgeSeconds).toBeNull();
    expect(health.averageSettlementLatencySeconds).toBeNull();
  });

  it('reports pending value and the oldest unsettled age', async () => {
    adapter.register(reference(11), USDC(1_000));
    clock.advance(60);
    adapter.register(reference(12), USDC(500));
    clock.advance(30);

    const health = await adapter.health();
    expect(health.pendingValue).toBe(USDC(1_500));
    expect(health.oldestUnsettledAgeSeconds).toBe(90);
  });

  /// Health must stay answerable while the transport is down — that is exactly
  /// when the risk engine most needs to know the backlog.
  it('still reports the backlog while unavailable', async () => {
    adapter.register(reference(13), USDC(2_000));
    clock.advance(45);
    adapter.setReachable(false);

    const health = await adapter.health();
    expect(health.transport).toBe('UNAVAILABLE');
    expect(health.pendingValue).toBe(USDC(2_000));
    expect(health.oldestUnsettledAgeSeconds).toBe(45);
  });

  it('reports observed latency once messages complete', async () => {
    const ref = reference(14);
    adapter.register(ref, USDC(1_000));
    clock.advance(DELAY);
    await adapter.complete(ref);

    const health = await adapter.health();
    expect(health.averageSettlementLatencySeconds).toBe(DELAY);
    expect(health.latencySampleSize).toBe(1);
  });

  it('reports degraded when settlement runs far behind schedule', async () => {
    const ref = reference(15);
    adapter.register(ref, USDC(1_000));
    clock.advance(DELAY * 3);
    await adapter.complete(ref);

    expect((await adapter.health()).transport).toBe('DEGRADED');
  });

  // -----------------------------------------------------------------------
  // Direction
  // -----------------------------------------------------------------------

  /// The transport neither knows nor cares which way a transfer runs.
  it('behaves identically in the mirrored direction', async () => {
    const ref = mirroredReference(16);
    adapter.register(ref, USDC(1_000));
    clock.advance(DELAY);

    const state = await adapter.complete(ref);
    expect(state.status).toBe(SettlementStatus.RECEIVED);
    expect(state.reference.sourceDomain).toBe(26);
    expect(state.reference.destinationDomain).toBe(0);
  });
});

describe('canonical delivery', () => {
  /// Real CCTP mints USDC to the destination receiver as part of completing.
  /// Without an equivalent the receiver holds nothing and settlement reverts,
  /// so the hook is part of the transport's contract rather than a convenience.
  it('delivers funds before recording receipt', async () => {
    const clock = new TestClock();
    const delivered: bigint[] = [];
    const adapter = new MockSettlementAdapter({
      attestationDelaySeconds: DELAY,
      clock: clock.now,
      onComplete: async (_ref, amount) => {
        delivered.push(amount);
      },
    });

    const ref = reference(40);
    adapter.register(ref, USDC(1_000));
    clock.advance(DELAY);
    await adapter.complete(ref);

    expect(delivered).toEqual([USDC(1_000)]);
  });

  /// A failed delivery must leave the message attested and retryable, not
  /// recorded as received.
  it('does not record receipt when delivery fails', async () => {
    const clock = new TestClock();
    let attempts = 0;
    const adapter = new MockSettlementAdapter({
      attestationDelaySeconds: DELAY,
      clock: clock.now,
      onComplete: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('mint failed');
      },
    });

    const ref = reference(41);
    adapter.register(ref, USDC(1_000));
    clock.advance(DELAY);

    await expect(adapter.complete(ref)).rejects.toThrow(/mint failed/);
    expect((await adapter.status(ref)).status).toBe(SettlementStatus.ATTESTED);

    expect((await adapter.complete(ref)).status).toBe(SettlementStatus.RECEIVED);
  });

  it('delivers exactly once across repeated completions', async () => {
    const clock = new TestClock();
    let calls = 0;
    const adapter = new MockSettlementAdapter({
      attestationDelaySeconds: DELAY,
      clock: clock.now,
      onComplete: async () => {
        calls += 1;
      },
    });

    const ref = reference(42);
    adapter.register(ref, USDC(1_000));
    clock.advance(DELAY);
    await adapter.complete(ref);
    await adapter.complete(ref);

    expect(calls).toBe(1);
  });
});
