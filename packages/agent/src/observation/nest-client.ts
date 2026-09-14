/**
 * The narrow SQL-over-HTTP surface `SqlNestObservationProvider` needs.
 *
 * "Nest" is Arcaidia's shared, unlimited indexer (WP-22) — a tiny interface
 * rather than a client library, same reasoning as `GraphQueryClient`: it
 * keeps the provider testable without a server, and swapping the transport
 * touches one file.
 */

export interface NestQueryResult<T> {
  readonly rows: readonly T[];
  readonly count: number;
  readonly truncated: boolean;
  readonly degraded: boolean;
}

export interface NestQueryClient {
  query<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>>;
  /** The indexer's own indexing-head freshness — see `nestObservedAt` below. */
  ready(endpoint: string): Promise<{ lastPollUnixtime: number; ready: boolean }>;
}

/** Wire shape of a nest's `/sql?q=` response — see this repo's own probing of the live endpoints. */
interface RawNestResponse<T> {
  readonly rows?: T[];
  readonly count?: number;
  readonly truncated?: boolean;
  readonly degraded?: boolean;
  readonly error?: string;
}

interface RawReadyResponse {
  readonly ready?: boolean;
  readonly last_poll_unixtime?: number;
  readonly lag_blocks?: number;
  readonly seconds_since_poll?: number;
  readonly stalled?: boolean;
  readonly tip_seal_stalled?: boolean;
}

/** A tip polled within this many seconds is fresh enough to decide on. */
const TIP_FRESH_SECONDS = 120;

/** A `fetch`-based client. Errors are surfaced, never swallowed — see the provider. */
const RETRYABLE_STATUS = new Set([429, 503]);
/** Production defaults: a whole pass must not die on one 429/503. Tests pass a faster policy. */
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 1_000;

export interface NestRetryPolicy {
  readonly attempts?: number;
  readonly delayMs?: number;
}

/**
 * The Nest enforces a small concurrency cap and answers `503 server busy` (or `429`) when a
 * handful of solvers and the site poll at once — confirmed live 2026-09-13, on `/ready` as much
 * as `/sql`. A transient rejection retried a moment later is not an outage, so both paths retry
 * briefly before giving up; a persistent one still surfaces as the error it is.
 */
async function fetchWithRetry(fetchImpl: typeof fetch, url: string, policy: NestRetryPolicy = {}): Promise<Response> {
  let last: Response | undefined;
  const attempts = policy.attempts ?? MAX_ATTEMPTS;
  const delayMs = policy.delayMs ?? RETRY_DELAY_MS;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await fetchImpl(url);
    if (!RETRYABLE_STATUS.has(last.status) || attempt === attempts) return last;
    await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
  }
  return last!;
}

export class FetchNestQueryClient implements NestQueryClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly retry: NestRetryPolicy = {},
  ) {}

  async query<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>> {
    const url = `${endpoint.replace(/\/+$/, '')}/sql?q=${encodeURIComponent(sql)}`;
    const response = await fetchWithRetry(this.fetchImpl, url, this.retry);
    const body = (await response.json().catch(() => ({}))) as RawNestResponse<T>;

    if (!response.ok) {
      throw new Error(`Nest query failed: ${response.status} ${body.error ?? response.statusText}`);
    }

    return {
      rows: body.rows ?? [],
      count: body.count ?? 0,
      truncated: body.truncated ?? false,
      degraded: body.degraded ?? false,
    };
  }

  async ready(endpoint: string): Promise<{ lastPollUnixtime: number; ready: boolean }> {
    const response = await fetchWithRetry(this.fetchImpl, `${endpoint.replace(/\/+$/, '')}/ready`, this.retry);
    const body = (await response.json().catch(() => null)) as RawReadyResponse | null;
    if (!response.ok && !body) {
      throw new Error(`Nest /ready failed: ${response.status} ${response.statusText}`);
    }
    // The Nest answers 503 with `ready: false` when its *sealing* (finalisation) has stalled,
    // while still polling and serving the chain tip — seen live on Sepolia, 2026-09-13, with
    // `lag_blocks: 0` and a fresh poll behind a 12-hour seal stall. What a solver needs is a
    // fresh tip, not a sealed one, so a stalled seal with a fresh tip counts as ready.
    const tipFresh =
      (body?.lag_blocks ?? Number.POSITIVE_INFINITY) === 0 &&
      (body?.seconds_since_poll ?? Number.POSITIVE_INFINITY) <= TIP_FRESH_SECONDS;
    const ready = Boolean(body?.ready) || (Boolean(body?.tip_seal_stalled ?? body?.stalled) && tipFresh);
    if (!response.ok && !ready) {
      throw new Error(`Nest /ready failed: ${response.status} ${response.statusText}`);
    }
    return { lastPollUnixtime: body?.last_poll_unixtime ?? 0, ready };
  }
}
