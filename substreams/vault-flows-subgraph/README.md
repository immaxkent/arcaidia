# vault-flows-subgraph

A `substreams/graph-entities` subgraph — indexes any ERC-4626 vault's
`Deposit`/`Withdraw` flows by consuming
[`../erc4626-vault-flows`](../erc4626-vault-flows)'s `graph_out` module
directly, with no AssemblyScript mapping of its own. This is
[WP-ERC4626-SUBSTREAMS.md](../../work-packages/WP-ERC4626-SUBSTREAMS.md)
§5.5's composability evidence: one Substreams package feeding a Graph
Studio subgraph, not just a standalone artifact.

## Status: code complete and verified, blocked on one dashboard step

Everything code-side works and is proven, not assumed:

- `graph_out` builds `EntityChanges` against our own dependency versions
  (see `../erc4626-vault-flows`'s commit history for the wasm-link issue this
  replaced), 14/14 tests pass, and `substreams pack` produces a clean
  two-module `.spkg`.
- `graph build` here compiles this subgraph against that package with no
  errors.
- `graph deploy` gets as far as building the artifact, uploading schema and
  package to IPFS successfully (`QmZyMgH9weGz1gLXSnhZVgkRccEYfogCYuLUki7MMLANj1`
  at time of writing), and only then fails with `Subgraph not found.`

That last error is real and expected: Subgraph Studio requires a subgraph
name to be *created* through the Studio dashboard (studio.thegraph.com — "Create
a Subgraph") before a deploy key can push a version to it. This is a
one-time, dashboard-only action — not something a deploy key or the CLI can
do on its own, and not something this session attempted to route around.

## To finish deploying

1. In Subgraph Studio, create a subgraph named `vault-flows-subgraph` (or
   whatever name you prefer — update `package.json`'s `deploy` script and
   the command below to match), network Ethereum Sepolia.
2. From this directory:
   ```
   npm run deploy
   ```
   (equivalent to `graph deploy --node https://api.studio.thegraph.com/deploy/ vault-flows-subgraph`
   — the deploy key from earlier subgraph deployments this session is
   already cached locally and does not need to be re-entered.)

## Rebuilding after a change to erc4626-vault-flows

```
cd ../erc4626-vault-flows && substreams pack substreams.yaml -o ../vault-flows-subgraph/substreams.spkg
cd ../vault-flows-subgraph && npm run deploy
```
