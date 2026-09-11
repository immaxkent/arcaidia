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

const RETRYABLE_STATUS = new Set([429, 503]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a `503 server busy: too many concurrent SQL queries` (confirmed
 * live, 2026-09-11 — the Nest enforces a real concurrency cap) or a `429`,
 * with a short fixed backoff. The console page alone can fire a handful of
 * these in parallel (one vault's worth of history is already 4 queries;
 * several vaults' worth, for the ecosystem utilisation chart, multiplies
 * that) — without a retry, a transient rejection here would surface as a
 * fabricated-looking "indexer down" error for a request that would have
 * succeeded a moment later.
 */
export async function queryNest<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>> {
  const url = `${endpoint.replace(/\/+$/, "")}/sql?q=${encodeURIComponent(sql)}`;

  let lastError: Error = new Error("unreachable");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url);
    const body = (await response.json()) as RawNestResponse<T>;

    if (!response.ok) {
      lastError = new Error(`Nest query failed: ${response.status} ${body.error ?? response.statusText}`);
      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw lastError;
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
  throw lastError;
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

/**
 * One vault's row from the Nest — the v2 `vaults` view (one row per factory vault, WP-27) first,
 * then the pre-v2 `vault` view for a Nest that has not been re-seeded yet. The migration window
 * is real (the re-seed is a third party's action), and every vault-row reader degrading the same
 * way beats each one failing differently.
 */
export async function queryVaultRow<T>(endpoint: string, columns: string, idLiteral: string): Promise<NestQueryResult<T>> {
  try {
    return await queryNest<T>(endpoint, `SELECT ${columns} FROM vaults WHERE id = ${idLiteral}`);
  } catch {
    return queryNest<T>(endpoint, `SELECT ${columns} FROM vault WHERE id = ${idLiteral}`);
  }
}
