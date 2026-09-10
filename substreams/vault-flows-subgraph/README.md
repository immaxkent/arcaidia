# vault-flows-subgraph

A `substreams/graph-entities` subgraph — indexes any ERC-4626 vault's
`Deposit`/`Withdraw` flows by consuming
[`../erc4626-vault-flows`](../erc4626-vault-flows)'s `graph_out` module
directly, with no AssemblyScript mapping of its own. This is
[WP-ERC4626-SUBSTREAMS.md](../../work-packages/WP-ERC4626-SUBSTREAMS.md)
§5.5's composability evidence: one Substreams package feeding a Graph
Studio subgraph, not just a standalone artifact.

## Status: staged, not yet deployable

`graph_out` (`../erc4626-vault-flows/src/graph_out.rs`) exists and its own
unit tests pass, but it isn't wired into that package's `substreams.yaml`
yet — see that module's own notes for why (a wasm-link conflict between
`substreams-entity-change`'s pinned `substreams` version and ours). This
directory's `schema.graphql` is written to match what `graph_out` already
produces, ready to deploy the moment that's resolved.

## Deploying, once graph_out is wired in

```
cd ../erc4626-vault-flows && substreams pack substreams.yaml -o ../vault-flows-subgraph/substreams.spkg
cd ../vault-flows-subgraph
graph auth --studio <DEPLOY_KEY>
npm run deploy
```
