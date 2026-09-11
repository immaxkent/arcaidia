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

- [ ] **23.1 A browser-side Nest client.** `apps/web/src/lib/arcaidia/subgraph.ts`'s
      `querySubgraph` (POST GraphQL) gets a sibling — a `queryNest(endpoint, sql)` matching
      `packages/agent/src/observation/nest-client.ts`'s `FetchNestQueryClient` wire contract
      (`GET {endpoint}/sql?q=<SELECT ...>`, `{ rows, count, truncated, degraded }`) exactly, so the
      two never silently drift on response shape. Browser `fetch`, not a shared package import —
      `packages/agent` is a Node-only workspace member, not built for bundling into `apps/web`.
- [ ] **23.2 `CHAIN_CONFIG` gains a committed default indexer URL**, mirroring
      `packages/domain/src/config/chains.ts`'s `subgraphUrl` — the same two Nest URLs, committed
      here too since `apps/web` cannot import `@arcaidia/domain`'s Node-side config wholesale.
      `VITE_SUBGRAPH_URL_{PREFIX}` becomes optional, overriding the default instead of being the
      only source — same override-with-committed-default shape used everywhere else this phase.
- [ ] **23.3 Rewrite `use-vault-fills.ts`'s three GraphQL documents as SQL.** `FILLS_WITH_SETTLEMENTS`,
      `SETTLEMENTS_FOR_INTENTS`, `INTENTS_FOR_IDS` become `SELECT` statements against the Nest's
      schema (fills / settlements / intents tables — see `sql-nest-observation-provider.ts` for the
      column names already confirmed live). Preserve the existing batching this file already does
      (one `SETTLEMENTS_FOR_INTENTS`-equivalent call for all fill ids at once, not one per row).
- [ ] **23.4 Same rewrite for `use-vaults.ts` and `use-intent-history.ts`.**
- [ ] **23.5 Carry over the nonce bug workaround.** WP-22 found the Nest's `intents` view returns
      `NULL` for `nonce` on every row (the `_dec` companion column overflows above 38 digits;
      Arcaidia's nonces are full-width `uint256`) and worked around it by reading the raw event
      table directly for that one field. Any frontend query surfacing `nonce` needs the identical
      workaround — check every SQL rewrite against this, not just the fill-listing ones.
- [ ] **23.6 `observedAt`/freshness from the Nest's own `/ready`**, not the local clock — same rule
      `GraphObservationProvider`/`SqlNestObservationProvider` already hold, now on the frontend too.

## Tests

- [ ] `queryNest` unit tests: request shape, response parsing, a non-2xx or `degraded: true`
      response surfaces as an error state, never a silent empty table.
- [ ] Each rewritten hook: same test shape `use-solver-telemetry.test.ts` established this phase
      (mock the fetch client, assert on the query issued and the parsed `DataState` result) —
      loading/ready/empty/unavailable/error all still render correctly, no fabricated values.
- [ ] A live smoke check against the real Nest endpoints (same category as WP-22's own live
      verification, and `test:chains`) — not part of `test:global`.

## Acceptance gate

`/console`, `/earn` and `/solver`'s indexed tables (fills, intent history, vault list) render real
data with zero `VITE_SUBGRAPH_URL_*` configured in the browser build, using the same shared,
unlimited endpoints the solver itself defaults to (WP-22) — no Studio dev key anywhere in the
frontend's own request path.
