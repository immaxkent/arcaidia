/**
 * "Keep doing this forever" around `runSolverPass`.
 *
 * Deliberately thin: every decision that matters (what counts as pending, how
 * a refusal is decided, how a failure is represented) already happened one
 * layer down, in `runSolverPass` and `processIntent`. This file's only job is
 * scheduling — poll, wait, poll again — and never let one tick's exception
 * stop the next tick from happening.
 */

import type { SolverDependencies } from '../solver/process-intent.js';
import { runSolverPass, type SolverPassResult } from './run-solver-pass.js';

export interface SolverWorkerOptions {
  /** How long to wait after one pass finishes before starting the next. */
  readonly pollIntervalMs: number;
  /** Called after every completed pass, success or DISCOVERY_FAILED alike. */
  readonly onPass?: (result: SolverPassResult) => void;
  /**
   * Called only if scheduling itself throws — runSolverPass already catches
   * discovery failures and per-intent errors, so this should stay quiet in
   * practice. It exists so a truly unexpected throw still surfaces somewhere
   * instead of silently killing the loop.
   */
  readonly onError?: (error: Error) => void;
  /** Injectable for tests; defaults to the real timers. */
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

export interface SolverWorkerHandle {
  /** Stops scheduling further passes. A pass already in flight still finishes. */
  stop(): void;
  readonly running: boolean;
}

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

export function startSolverWorker(
  deps: SolverDependencies,
  options: SolverWorkerOptions,
): SolverWorkerHandle {
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));

  let stopped = false;
  let timer: unknown;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const result = await runSolverPass(deps);
      options.onPass?.(result);
    } catch (error) {
      options.onError?.(asError(error));
    }
    if (!stopped) {
      timer = schedule(() => void tick(), options.pollIntervalMs);
    }
  };

  void tick();

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
