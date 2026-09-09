import { describe, expect, it, vi } from 'vitest';
import {
  InMemorySettlementJournal,
  MockSettlementAdapter,
  startSettlementWorker,
  type SettlementWorkerDependencies,
  type SettlementWorkerPassResult,
} from '../src/index.js';
import type { SettlementDiscoveryProvider } from '../src/observation/discover-settlements.js';
import type { SettlementRecord } from '../src/worker/ports.js';
import { ARC, SEPOLIA, TestClock, USDC, reference } from './fixtures.js';
import { FakeReceiverClient } from './worker-fakes.js';

const ARC_RECEIVER = '0x6666666666666666666666666666666666666666' as const;
const SEPOLIA_RECEIVER = '0x3333333333333333333333333333333333333333' as const;
const RECIPIENT = '0x2222222222222222222222222222222222222222' as const;

class FakeDiscovery implements SettlementDiscoveryProvider {
  records: SettlementRecord[] = [];
  failWith: Error | null = null;

  async pendingSettlements(): Promise<readonly SettlementRecord[]> {
    if (this.failWith) throw this.failWith;
    return this.records;
  }
}

/**
 * Same manually-advanced fake scheduler `solver-worker.test.ts` uses, for the
 * identical reason: the worker's tick -> await pass -> schedule chain needs a
 * real microtask flush between "the timer fired" and "the next schedule()
 * call happened", which fake timers make fiddly to get right.
 */
function fakeScheduler() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  let nextHandle = 0;
  return {
    schedule: (fn: () => void, ms: number) => {
      const handle = nextHandle++;
      pending.push({ fn, ms });
      return handle;
    },
    cancel: () => {
      pending.length = 0;
    },
    async advance(): Promise<boolean> {
      const next = pending.shift();
      if (!next) return false;
      next.fn();
      await flushMicrotasks();
      return true;
    },
    get scheduledCount() {
      return pending.length;
    },
  };
}

/**
 * More flushes than `solver-worker.test.ts` needs: a discovered record's pass
 * chains discovery -> journal/registrar writes -> runSettlementPass ->
 * processSettlement -> receiverClient.isSettled -> adapter.status, each an
 * `await` hop the microtask queue needs to drain separately.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

function buildDeps(discovery: FakeDiscovery): SettlementWorkerDependencies {
  const clock = new TestClock();
  const adapter = new MockSettlementAdapter({ attestationDelaySeconds: 120, clock: clock.now });
  return {
    adapter,
    receivers: new Map([
      [ARC, ARC_RECEIVER],
      [SEPOLIA, SEPOLIA_RECEIVER],
    ]),
    receiverClient: new FakeReceiverClient(),
    journal: new InMemorySettlementJournal(),
    clock: clock.now,
    discovery,
    registrar: adapter,
  };
}

describe('startSettlementWorker', () => {
  it('runs a pass immediately, without waiting for the first interval', async () => {
    const discovery = new FakeDiscovery();
    discovery.records = [{ reference: reference(1), amount: USDC(1_000), fallbackRecipient: RECIPIENT }];
    const scheduler = fakeScheduler();
    const passes: SettlementWorkerPassResult[] = [];

    const handle = startSettlementWorker(buildDeps(discovery), {
      pollIntervalMs: 1_000,
      onPass: (result) => passes.push(result),
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    await flushMicrotasks();

    expect(passes).toHaveLength(1);
    expect(passes[0]?.kind).toBe('RAN');
    handle.stop();
  });

  it('schedules the next pass only after the previous one finishes', async () => {
    const discovery = new FakeDiscovery();
    const scheduler = fakeScheduler();
    const passes: SettlementWorkerPassResult[] = [];

    const handle = startSettlementWorker(buildDeps(discovery), {
      pollIntervalMs: 500,
      onPass: (result) => passes.push(result),
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    await flushMicrotasks();
    expect(passes).toHaveLength(1);
    expect(scheduler.scheduledCount).toBe(1);

    await scheduler.advance();
    expect(passes).toHaveLength(2);
    await scheduler.advance();
    expect(passes).toHaveLength(3);

    handle.stop();
  });

  it('stop() prevents any further scheduled pass from running', async () => {
    const discovery = new FakeDiscovery();
    const scheduler = fakeScheduler();
    const passes: SettlementWorkerPassResult[] = [];

    const handle = startSettlementWorker(buildDeps(discovery), {
      pollIntervalMs: 500,
      onPass: (result) => passes.push(result),
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    await flushMicrotasks();
    expect(passes).toHaveLength(1);

    handle.stop();
    expect(handle.running).toBe(false);
    expect(scheduler.scheduledCount).toBe(0);

    const ranAnother = await scheduler.advance();
    expect(ranAnother).toBe(false);
    expect(passes).toHaveLength(1);
  });

  it('one pass reporting DISCOVERY_FAILED does not stop the next pass from being scheduled', async () => {
    const discovery = new FakeDiscovery();
    discovery.failWith = new Error('subgraph down');
    const scheduler = fakeScheduler();
    const passes: SettlementWorkerPassResult[] = [];

    const handle = startSettlementWorker(buildDeps(discovery), {
      pollIntervalMs: 500,
      onPass: (result) => passes.push(result),
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    await flushMicrotasks();
    expect(passes[0]?.kind).toBe('DISCOVERY_FAILED');
    expect(scheduler.scheduledCount).toBe(1);

    discovery.failWith = null;
    await scheduler.advance();
    expect(passes[1]?.kind).toBe('RAN');

    handle.stop();
  });

  it('a throwing onPass callback is caught and reported via onError, not left to crash the loop', async () => {
    const discovery = new FakeDiscovery();
    const scheduler = fakeScheduler();
    const errors: Error[] = [];

    const handle = startSettlementWorker(buildDeps(discovery), {
      pollIntervalMs: 500,
      onPass: () => {
        throw new Error('callback bug');
      },
      onError: (error) => errors.push(error),
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    await flushMicrotasks();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('callback bug');
    expect(scheduler.scheduledCount).toBe(1);

    handle.stop();
  });

  it('defaults to real timers when none are injected', async () => {
    vi.useFakeTimers();
    try {
      const discovery = new FakeDiscovery();
      const passes: SettlementWorkerPassResult[] = [];
      const handle = startSettlementWorker(buildDeps(discovery), {
        pollIntervalMs: 10,
        onPass: (result) => passes.push(result),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(passes).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(10);
      expect(passes).toHaveLength(2);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
