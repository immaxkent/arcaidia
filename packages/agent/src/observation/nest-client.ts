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
}

/** A `fetch`-based client. Errors are surfaced, never swallowed — see the provider. */
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

  async ready(endpoint: string): Promise<{ lastPollUnixtime: number; ready: boolean }> {
    const response = await this.fetchImpl(`${endpoint.replace(/\/+$/, '')}/ready`);
    if (!response.ok) {
      throw new Error(`Nest /ready failed: ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as RawReadyResponse;
    return { lastPollUnixtime: body.last_poll_unixtime ?? 0, ready: body.ready ?? false };
  }
}
