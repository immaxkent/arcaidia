/**
 * The narrow SQL-over-HTTP surface settlement discovery needs from Arcaidia's shared
 * indexer ("the Nest", WP-22): `GET {endpoint}/sql?q=<SELECT ...>`.
 *
 * Deliberately duplicated from `@arcaidia/agent`'s identical client rather than imported, for
 * the same reason as `graph-client.ts`: the two packages are independently swappable halves,
 * and the type is tiny — `fetch` plumbing and one response envelope.
 */

export interface NestQueryResult<T> {
  readonly rows: readonly T[];
  readonly count: number;
  readonly truncated: boolean;
  readonly degraded: boolean;
}

export interface NestQueryClient {
  query<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>>;
}

interface RawNestResponse<T> {
  readonly rows?: T[];
  readonly count?: number;
  readonly truncated?: boolean;
  readonly degraded?: boolean;
  readonly error?: string;
}

/** A `fetch`-based client. Errors are surfaced, never swallowed — see the discovery provider. */
const RETRYABLE_STATUS = new Set([429, 503]);
/** Production defaults: a whole pass must not die on one 429/503. Tests pass a faster policy. */
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 1_000;

export interface NestRetryPolicy {
  readonly attempts?: number;
  readonly delayMs?: number;
}

/** Same brief retry as the agent's client: the Nest's concurrency cap answers 503 under load. */
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
}
