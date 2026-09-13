/**
 * One gate in front of every JSON-RPC read the browser makes.
 *
 * Measured 2026-09-13 from the same Mac the app runs on: Circle's Arc RPC answers a single call
 * in 3–5 s and drops the connection outright under a 60-call burst; dRPC drops after ~14 rapid
 * calls; publicnode and Infura tolerate 60 in parallel. The app's own polling (vault directory,
 * owned vaults, fills, balances, log scans) is what pushes those hosts over, and the wallet's
 * transaction path then pays for it. This limiter bounds in-flight requests per host and backs
 * off on the two failure shapes those providers actually produce — an HTTP 429 and a dropped
 * connection (a `fetch` TypeError) — so bursts are smoothed instead of failed.
 */

interface Gate {
  active: number;
  queue: Array<() => void>;
}

const gates = new Map<string, Gate>();
const DEFAULT_MAX_CONCURRENT = 3;
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;

function gateFor(host: string): Gate {
  let gate = gates.get(host);
  if (!gate) {
    gate = { active: 0, queue: [] };
    gates.set(host, gate);
  }
  return gate;
}

async function acquire(gate: Gate, max: number): Promise<void> {
  if (gate.active < max) {
    gate.active += 1;
    return;
  }
  await new Promise<void>((resolve) => gate.queue.push(resolve));
  gate.active += 1;
}

function release(gate: Gate): void {
  gate.active -= 1;
  const next = gate.queue.shift();
  if (next) next();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hostOf(input: RequestInfo | URL): string {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

export interface ThrottleOptions {
  /** In-flight requests allowed per host. */
  readonly maxConcurrent?: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleepFn?: (ms: number) => Promise<unknown>;
}

/** A `fetch` that queues per host and retries 429s and dropped connections with backoff. */
export function throttledFetch(options: ThrottleOptions = {}): typeof fetch {
  const max = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.sleepFn ?? sleep;

  return async (input, init) => {
    const gate = gateFor(hostOf(input));
    let attempt = 0;
    for (;;) {
      attempt += 1;
      await acquire(gate, max);
      try {
        const response = await fetchImpl(input, init);
        if (response.status !== 429 && response.status !== 503) return response;
        if (attempt >= MAX_ATTEMPTS) return response;
      } catch (error) {
        // A dropped connection surfaces as a TypeError from fetch; anything else is not retried.
        if (!(error instanceof TypeError) || attempt >= MAX_ATTEMPTS) throw error;
      } finally {
        release(gate);
      }
      await wait(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  };
}

/** Test seam: how many requests are in flight for a host right now. */
export function inFlightFor(host: string): number {
  return gates.get(host)?.active ?? 0;
}
