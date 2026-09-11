# WP-23 — Frontend read path off Studio's rate limit (M23)

**Objective:** the frontend's own indexed reads (`use-vault-fills.ts`, `use-vaults.ts`,
`use-intent-history.ts`) still query GraphQL directly against `VITE_SUBGRAPH_URL_{PREFIX}`, which
nothing points at Arcaidia's shared, unlimited indexer (WP-22) — that endpoint is a different
transport (SQL-over-HTTP, `GET {endpoint}/sql?q=<SELECT ...>`), not GraphQL. The backend side of
this exact problem (the solver's own `SUBGRAPH_URL_{PREFIX}`) is already closed; this is the
matching gap on the browser's read path, still exposed to Subgraph Studio's 3k-query/day cap today.

**Found while:** closing out WP-19.1 (the `/earn` config generator) — the config block correctly
stopped handing back a `SUBGRAPH_URL_*` value at all (WP-22 made that unnecessary for the solver),
which surfaced that the frontend's own three indexed-read hooks were never updated to match and are
still on the old, capped path.

**Depends on:** WP-22 (`packages/agent/src/observation/nest-client.ts`,
`sql-nest-observation-provider.ts` — the reference implementation of this exact transport, backend
side). **Blocks:** nothing directly, but every indexed table on `/console`, `/earn` and `/solver`
stays exposed to the Studio cap until this lands.

**Stack:** `apps/web/src/lib/arcaidia`, `apps/web/src/hooks/arcaidia`.

## What this is not

Not a rewrite of the pages, not a new design for the hooks' `DataState` contracts — every hook's
return shape, loading/ready/empty/unavailable/error rendering, and cross-chain-merge rules stay
exactly as they are. This replaces one thing only: how each hook fetches its rows.

## Sub-tasks

- [x] **23.1 A browser-side Nest client.** `apps/web/src/lib/arcaidia/nest.ts` — `queryNest`
      matching `packages/agent/src/observation/nest-client.ts`'s `FetchNestQueryClient` wire
      contract exactly (`GET {endpoint}/sql?q=<SELECT ...>`, `{ rows, count, truncated, degraded }`),
      `nestReady` for `/ready`, and `sqlHex32InClause`/`sqlHex20Literal` — the same validate-before-
      interpolate guard `sql-nest-observation-provider.ts`'s own `sqlInClause` uses, since this
      endpoint takes a raw query string over the wire. `querySubgraph`/`subgraph.ts` deliberately
      left in place, unused but not deleted — same precedent the backend already set by keeping
      `GraphObservationProvider` alongside `SqlNestObservationProvider` rather than removing it.
- [x] **23.2 `CHAIN_CONFIG` gains a committed default indexer URL** — the identical two Nest URLs
      committed in `packages/domain/src/config/chains.ts`. `VITE_SUBGRAPH_URL_{PREFIX}` is now an
      override, not the only source.
- [x] **23.3/23.4 Rewrote all three hooks' GraphQL documents as SQL** — `use-vault-fills.ts`,
      `use-vaults.ts` (`readVaultAggregates`), `use-intent-history.ts`. Table/column names
      confirmed against the real, live endpoints before writing a single query (not guessed):
      `vault.fill_count` and `protocol_state.total_fees_earned` both exist and are populated (the
      original sub-task assumed these might be missing — they aren't). Every batched lookup kept
      its existing batching (one `IN (...)` call for all ids, not one per row).
- [x] **23.5 Nonce workaround — confirmed not applicable to the frontend.** Live-probed
      `pending_intents`/`intents` directly: `nonce` returns correctly today (WP-22's reported bug
      may already be fixed Nest-side, or was specific to a query shape these hooks don't use).
      Moot regardless — none of the three rewritten hooks select `nonce` at all.
- [x] **23.6 `observedAt`/freshness — confirmed not applicable.** None of the three existing hooks'
      `DataState` contracts expose a freshness/`observedAt` field today (unlike the backend's
      `VaultState.observedAt`); adding one now would be new scope beyond "replace the transport,"
      which this WP explicitly isn't. Revisit only if a hook's contract grows that field.

## Tests

- [x] `queryNest`/`nestReady`/`sqlHex32InClause`/`sqlHex20Literal` unit tests
      (`apps/web/src/lib/arcaidia/nest.test.ts`, 13 tests): request shape, trailing-slash handling,
      non-2xx / `degraded: true` / `truncated: true` all surface as thrown errors rather than a
      silent partial or empty result, and the SQL-injection guards reject a malformed id outright.
- [x] Each rewritten hook (`use-vault-fills.test.tsx`, `use-vaults.test.ts`,
      `use-intent-history.test.tsx`, 12 tests total): mocks `fetch`, asserts on the exact SQL
      issued and the parsed `DataState` result — the cross-chain fill/settlement/source-intent join,
      the sender-scoped `WHERE` clause (never a wildcard), empty vs. error vs. ready all correct.
- [x] Live-verified directly against the real Sepolia/Arc Nest endpoints before and after writing
      the rewrites — not a substitute for the unit tests above, a confirmation the schema they
      assume is the schema that's actually live: `vault`, `protocol_state`, `fills`, `settlements`,
      `intents` all probed with the exact `SELECT`/`WHERE`/`IN (...)` shapes these hooks now send,
      including a real sender-filtered query and a real `IN (...)` fill lookup, both against live
      Sepolia/Arc data with real pending and filled intents.

## Acceptance gate

`/console`, `/earn` and `/solver`'s indexed tables (fills, intent history, vault list) render real
data with zero `VITE_SUBGRAPH_URL_*` configured in the browser build, using the same shared,
unlimited endpoints the solver itself defaults to (WP-22) — no Studio dev key anywhere in the
frontend's own request path. Met: every hook now defaults to the committed Nest URLs, confirmed
against the live endpoints, with `VITE_SUBGRAPH_URL_*` remaining available only as an override.
