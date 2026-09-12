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
export class FetchNestQueryClient implements NestQueryClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async query<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>> {
    const url = `${endpoint.replace(/\/+$/, '')}/sql?q=${encodeURIComponent(sql)}`;
    const response = await this.fetchImpl(url);
    const body = (await response.json()) as RawNestResponse<T>;

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
