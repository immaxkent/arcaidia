/**
 * Browser-side and agent-side both have their own copy of this exact
 * minimal SQL-over-HTTP client (`apps/web/src/lib/arcaidia/nest.ts`,
 * `packages/agent/src/observation/nest-client.ts`) — this is the Relay's,
 * kept deliberately independent rather than shared, matching that existing
 * precedent: each runtime's copy stays free to evolve on its own, and none
 * of them needs more than this.
 */
export interface NestQueryResult<T> {
  readonly rows: readonly T[];
  readonly count: number;
  readonly truncated: boolean;
  readonly degraded: boolean;
}

interface RawNestResponse<T> {
  readonly rows?: T[];
  readonly count?: number;
  readonly truncated?: boolean;
  readonly degraded?: boolean;
  readonly error?: string;
}

export interface NestQueryClient {
  query<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>>;
}

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
