# vault-flows-subgraph

A `substreams/graph-entities` subgraph, scaffolded to index any ERC-4626
vault's `Deposit`/`Withdraw` flows by consuming
[`../erc4626-vault-flows`](../erc4626-vault-flows)'s `graph_out` module
directly, with no AssemblyScript mapping of its own.

## Status: this integration path is dead, not just blocked

Everything code-side works — `graph_out` builds real `EntityChanges`, this
directory's `subgraph.yaml`/`schema.graphql` are correct and validated by
`graph build` — but the deploy itself, attempted 2026-09-11 against a real
Studio subgraph (`arcaidia-vault-flows`, created via the dashboard, deploy
key already cached), fails with:

```
Substreams-powered Subgraphs, originally intended for non-EVM chains, are
no longer supported. If you need help migrating to standalone Substreams,
please reach out in the #substreams channel on Discord.
```

Confirmed against current sources, not assumed from the error text alone:
graph-node has removed substreams-triggered subgraph support entirely. This
is a platform capability that no longer exists, not a configuration problem
— no amount of further engineering on this repo fixes it. The currently
supported composability pattern for a Substreams package is a **sink**
(SQL/Postgres/ClickHouse, or direct gRPC), not a Studio subgraph data
source. See `WP-ERC4626-SUBSTREAMS.md` for the resulting scope decision.

This directory is kept as-is rather than deleted: it's real, working proof
that the integration was built correctly and reached exactly the platform's
current removal, not an implementation bug.
