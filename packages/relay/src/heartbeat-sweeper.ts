/**
 * "Keep checking for stale heartbeats forever" — the scheduling wrapper
 * around `RelayStore.sweepHeartbeats()`, kept as thin and in the same shape
 * as `packages/agent/src/worker/solver-worker.ts`'s solver loop: real logic
 * lives in the store, this file only knows how to keep calling it.
 */
export interface HeartbeatSweeperOptions {
  readonly intervalMs: number;
  /** Injectable for tests; defaults to the real timers. */
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

export interface HeartbeatSweeperHandle {
  stop(): void;
  readonly running: boolean;
}

export function startHeartbeatSweeper(
  sweep: () => void,
  options: HeartbeatSweeperOptions,
): HeartbeatSweeperHandle {
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));

  let stopped = false;
  let timer: unknown;

  const tick = (): void => {
    if (stopped) return;
    sweep();
    if (!stopped) timer = schedule(tick, options.intervalMs);
  };

  timer = schedule(tick, options.intervalMs);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== undefined) cancel(timer);
    },
    get running() {
      return !stopped;
    },
  };
}
