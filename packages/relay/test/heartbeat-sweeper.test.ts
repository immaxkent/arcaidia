import { describe, expect, it } from 'vitest';
import { startHeartbeatSweeper } from '../src/heartbeat-sweeper.js';

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
    fire(): boolean {
      const next = pending.shift();
      if (!next) return false;
      next.fn();
      return true;
    },
    get scheduledCount() {
      return pending.length;
    },
    get lastIntervalMs() {
      return pending.at(-1)?.ms;
    },
  };
}

describe('startHeartbeatSweeper', () => {
  it('does not sweep immediately — only once the interval elapses', () => {
    const scheduler = fakeScheduler();
    let sweeps = 0;

    const handle = startHeartbeatSweeper(() => sweeps++, {
      intervalMs: 1_000,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    expect(sweeps).toBe(0);
    expect(scheduler.scheduledCount).toBe(1);
    expect(scheduler.lastIntervalMs).toBe(1_000);

    handle.stop();
  });

  it('sweeps and reschedules on every fire', () => {
    const scheduler = fakeScheduler();
    let sweeps = 0;

    const handle = startHeartbeatSweeper(() => sweeps++, {
      intervalMs: 1_000,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    scheduler.fire();
    expect(sweeps).toBe(1);
    expect(scheduler.scheduledCount).toBe(1);

    scheduler.fire();
    expect(sweeps).toBe(2);

    handle.stop();
  });

  it('stop() prevents any further sweep from being scheduled', () => {
    const scheduler = fakeScheduler();
    let sweeps = 0;

    const handle = startHeartbeatSweeper(() => sweeps++, {
      intervalMs: 1_000,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });

    handle.stop();
    expect(handle.running).toBe(false);
    expect(scheduler.scheduledCount).toBe(0);

    const firedAnyway = scheduler.fire();
    expect(firedAnyway).toBe(false);
    expect(sweeps).toBe(0);
  });

  it('defaults to real timers when none are injected', async () => {
    let sweeps = 0;
    const handle = startHeartbeatSweeper(() => sweeps++, { intervalMs: 5 });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sweeps).toBeGreaterThan(0);

    handle.stop();
  });
});
