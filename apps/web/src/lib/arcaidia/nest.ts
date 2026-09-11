/**
 * Browser-side client for Arcaidia's shared, unlimited indexer ("the Nest",
 * WP-22) — SQL-over-HTTP, `GET {endpoint}/sql?q=<SELECT ...>`, not GraphQL.
 *
 * Mirrors `packages/agent/src/observation/nest-client.ts`'s `FetchNestQueryClient`
 * wire contract exactly, so the two never silently drift on response shape.
 * Not imported from that package directly: `packages/agent` is a Node-only
 * workspace member, not built for bundling into a browser app.
 */
import type { Hex } from "./types";

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

interface RawReadyResponse {
  readonly ready?: boolean;
  readonly last_poll_unixtime?: number;
}

export async function queryNest<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>> {
  const url = `${endpoint.replace(/\/+$/, "")}/sql?q=${encodeURIComponent(sql)}`;
  const response = await fetch(url);
  const body = (await response.json()) as RawNestResponse<T>;

  if (!response.ok) {
    throw new Error(`Nest query failed: ${response.status} ${body.error ?? response.statusText}`);
  }
  if (body.degraded) {
    throw new Error(`Nest reports degraded data for this query on ${endpoint}.`);
  }
  if (body.truncated) {
    throw new Error(`Nest query truncated on ${endpoint} — narrow the query or raise the limit.`);
  }

  return {
    rows: body.rows ?? [],
    count: body.count ?? 0,
    truncated: body.truncated ?? false,
    degraded: body.degraded ?? false,
  };
}

export async function nestReady(endpoint: string): Promise<{ ready: boolean; lastPollUnixtime: number }> {
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/ready`);
  if (!response.ok) {
    throw new Error(`Nest /ready failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as RawReadyResponse;
  return { ready: body.ready ?? false, lastPollUnixtime: body.last_poll_unixtime ?? 0 };
}

const HEX_32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HEX_20_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * A safe SQL `IN (...)` clause from a list of intent/tx ids (32-byte hex).
 * Matches `sql-nest-observation-provider.ts`'s identical guard — every
 * value is validated against a fixed hex shape *before* it ever touches a
 * SQL string, since this endpoint takes a raw query string over the wire.
 */
export function sqlHex32InClause(values: readonly Hex[]): string {
  for (const value of values) {
    if (!HEX_32_PATTERN.test(value)) {
      throw new Error(`Refusing to build a SQL IN-clause from a non-hex32 value: ${value}`);
    }
  }
  return values.map((value) => `'${value.toLowerCase()}'`).join(", ");
}

/** Same guard, for a single 20-byte address value interpolated into a query (e.g. `sender = '...'`). */
export function sqlHex20Literal(value: string): string {
  if (!HEX_20_PATTERN.test(value)) {
    throw new Error(`Refusing to interpolate a non-address value into SQL: ${value}`);
  }
  return `'${value.toLowerCase()}'`;
}
