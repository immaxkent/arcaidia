# erc4626-vault-flows

A generic [Substreams](https://substreams.dev) module that decodes the two
standard [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626) tokenized-vault
events — `Deposit` and `Withdraw` — from **any** conforming vault on Ethereum.
It matches on event *signature*, never on an allowlisted contract address, so
it works against a vault it has never seen before with zero configuration.

Built as part of [Arcaidia](https://github.com/immaxkent/arcaidia)'s
work-package `WP-ERC4626-SUBSTREAMS.md`, but deliberately carries no
Arcaidia-specific field or event — nothing here assumes the reader is running
Arcaidia's own vault.

## What it does

`map_vault_flows` takes one Ethereum block and returns every `Deposit` and
`Withdraw` event any address emitted in it, decoded into:

- `sender` / `owner` / `receiver` — the indexed addresses the event itself carries
- `assets` / `shares` — the ERC-20 amounts, as a big-endian byte string
  (protobuf has no native uint256; see `proto/erc4626/v1/erc4626.proto`)
- `vault`, `tx_hash`, `block_number`, `block_timestamp`, `log_index` — where it happened

## Why it's Ethereum/Sepolia-only

Substreams is built on [Firehose](https://firehose.streamingfast.io/), and not
every network The Graph indexes has Firehose support. Checked directly against
The Graph's own network registry: Arc (mainnet and testnet) currently has
none. Ethereum mainnet and Sepolia both have full support. This module targets
`sepolia` in `substreams.yaml` by default — change `network:` to point it at
any other Firehose-backed network, no code change required.

## Using it against your own vault

Nothing to configure. If your contract implements EIP-4626's standard
`Deposit`/`Withdraw` events, this module already decodes it — point it at
your network, run it, and your vault's flows appear in the output stream
alongside anyone else's. This is what "generic" means in practice: there is
no per-vault setup step to skip.

## graph_out — feeding a Graph Studio subgraph directly

A second module, `graph_out`, takes `map_vault_flows`'s output and renders it
as `EntityChanges` — the shape a `substreams/graph-entities` Studio subgraph
data source consumes with **no AssemblyScript mapping of its own**. See
[`../vault-flows-subgraph`](../vault-flows-subgraph) — one Substreams package
composed directly into a Graph product, not just a standalone artifact.

## What became easier

The honest, specific answer, not marketing copy:

- **No per-vault subgraph mapping code, ever.** A conventional subgraph needs
  a handwritten AssemblyScript handler per event, per project. Because
  `graph_out` reads the *standard* schema, the same compiled module — with
  zero recompilation — produces correct entities for any conforming vault.
  Building `vault-flows-subgraph` took a `schema.graphql` and a five-line
  `subgraph.yaml`; the "mapping" is the generic Substreams module, already
  written and tested before this subgraph existed.
- **Decoding logic never needed a second version.** The exact same
  `abi::decode_deposit`/`decode_withdraw` that indexes Arcaidia's own vault
  is proven — by a dedicated test, not by inspection — to decode identically
  for an arbitrary address (`does_not_hardcode_or_special_case_any_particular_vault_address`).
  There is no "and now adapt it for vault #2" step at all.
- **The composability came from vendoring one canonical schema, not from
  writing new plumbing.** `graph_out` exists as ~150 lines because
  `sf.substreams.sink.entity.v1.EntityChanges` is a schema graph-node already
  knows how to sink — fetching and using that exact schema (see its own
  `.proto` file for provenance) was the entire integration surface. No new
  indexer code, no new sink, no bespoke protocol.

## Build

```
substreams protogen substreams.yaml --output-path src/pb   # regenerate bindings after a schema change
cargo build --release --target wasm32-unknown-unknown
substreams pack substreams.yaml
```

## Test

```
cargo test
```

Unit tests decode hand-built log fixtures — no live network or RPC endpoint
required. They also enforce the genericness bar directly: one test
(`does_not_hardcode_or_special_case_any_particular_vault_address`) fails if
the decoder is ever made to special-case an address.

## License

MIT — see `LICENSE`. Chosen because this module exists to be reused by anyone
running a conforming vault, and a permissive license is what actually makes
that true in practice, not just in the description.
