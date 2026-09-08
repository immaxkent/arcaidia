import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDeployment, resetDeployments } from '@arcaidia/domain';
import {
  DEFAULT_RISK_POLICY,
  InMemorySubmissionJournal,
  SequentialNonceSource,
  startSolverWorker,
  type SolverDependencies,
  type SolverPassResult,
} from '../src/index.js';
import { InMemoryDecisionLog } from '../src/logging/decision-log.js';
import { NOW, health, intent, vault } from './fixtures.js';
import { FakeObservationProvider, FakeSourceReader, FakeSubmitter, RecordingAuthority } from './solver-fakes.js';

/**
 * A manually-advanced fake scheduler, rather than vi.useFakeTimers(): the
 * worker's own promise chain (tick -> await runSolverPass -> schedule next)
 * needs a real microtask flush between "the timer fired" and "the next
 * schedule() call happened", which fake timers make fiddly to get right.
 * Flushing microtasks explicitly keeps these tests reading step by step.
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
    /** Runs the oldest scheduled call, if any, and lets its promise chain settle. */
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('startSolverWorker', () => {
  let observation: FakeObservationProvider;
  let deps: SolverDependencies;

  beforeEach(() => {
    registerDeployment('ethereum-sepolia', {
      intentRouter: '0x1111111111111111111111111111111111111111',
      liquidityVault: '0x2222222222222222222222222222222222222222',
      settlementReceiver: '0x3333333333333333333333333333333333333333',
    });
    registerDeployment('arc-testnet', {
      intentRouter: '0x4444444444444444444444444444444444444444',
      liquidityVault: '0x5555555555555555555555555555555555555555',
      settlementReceiver: '0x6666666666666666666666666666666666666666',
    });

    observation = new FakeObservationProvider(vault(), health());
    deps = {
      observation,
      sourceReader: new FakeSourceReader({
        txHash: intent().sourceTxHash,
        status: 'success',
        to: null,
        blockNumber: 100n,
        currentBlockNumber: 110n,
        intentCreated: null,
      }),
      authority: new RecordingAuthority(),
      submitter: new FakeSubmitter(),
      log: new InMemoryDecisionLog(),
      clock: () => NOW,
      nonces: new SequentialNonceSource(),
      journal: new InMemorySubmissionJournal(),
      config: { policy: DEFAULT_RISK_POLICY, authorizationTtlSeconds: 45 },
    };
  });

  afterEach(() => resetDeployments());

  it('runs a pass immediately, without waiting for the first interval', async () => {
    const scheduler = fakeScheduler();
    const passes: SolverPassResult[] = [];

    const handle = startSolverWorker(deps, {
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
    const scheduler = fakeScheduler();
    const passes: SolverPassResult[] = [];

    const handle = startSolverWorker(deps, {
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
    const scheduler = fakeScheduler();
    const passes: SolverPassResult[] = [];

    const handle = startSolverWorker(deps, {
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

    // Even if something external still invoked the timer callback, a stopped
    // worker must not schedule yet another one after it.
    const ranAnother = await scheduler.advance();
    expect(ranAnother).toBe(false);
    expect(passes).toHaveLength(1);
  });

  it('one pass reporting DISCOVERY_FAILED does not stop the next pass from being scheduled', async () => {
    const scheduler = fakeScheduler();
    const passes: SolverPassResult[] = [];
    observation.pendingIntentsFailWith = new Error('subgraph down');

    const handle = startSolverWorker(deps, {
      pollIntervalMs: 500,
      onPass: (result) => passes.push(result),
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    await flushMicrotasks();
    expect(passes[0]?.kind).toBe('DISCOVERY_FAILED');
    expect(scheduler.scheduledCount).toBe(1);

    observation.pendingIntentsFailWith = null;
    await scheduler.advance();
    expect(passes[1]?.kind).toBe('RAN');

    handle.stop();
  });

  it('a throwing onPass callback is caught and reported via onError, not left to crash the loop', async () => {
    const scheduler = fakeScheduler();
    const errors: Error[] = [];

    const handle = startSolverWorker(deps, {
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
    // The loop kept scheduling despite the callback's own bug.
    expect(scheduler.scheduledCount).toBe(1);

    handle.stop();
  });

  it('defaults to real timers when none are injected', async () => {
    vi.useFakeTimers();
    try {
      const passes: SolverPassResult[] = [];
      const handle = startSolverWorker(deps, {
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
