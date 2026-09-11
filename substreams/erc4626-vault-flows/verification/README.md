# Live verification (WP-ERC4626-SUBSTREAMS.md §5.3)

`sepolia-block-11675763.json` is the raw output of:

```
substreams run substreams.yaml map_vault_flows -s 11675763 -t +1 -o json
```

against the real, live Ethereum Sepolia Firehose endpoint (provisioned API key,
2026-09-11), not a local fixture — this is the actual wasm module running
against the actual chain. Block 11675763 was chosen because it's the exact
block containing Arcaidia's own real $100 test deposit, independently
verified earlier via `cast logs` and `cast call totalSupply()`.

**The module decoded four deposits in this one block — three of them from
vaults this project has never seen and never configured.** Arcaidia's own
vault (`0xc74e693938dfbf7c11b787ba27cdde4c0215aaf1`) is one of the four; the
other three (`0x753937...`, `0x93083f...`, `0x93310a...`) are unrelated
ERC-4626 vaults that happened to receive deposits in the same block. This is
the genericness bar from WP §2 (§5.2), demonstrated live rather than only
asserted or exercised against a synthetic address in a unit test.

Cross-checked: Arcaidia's own entry decodes `assets: 0x05f5e100` (100,000,000
= 100 USDC at 6 decimals) and `shares: 0x5af3107a4000` (100,000,000,000,000)
— exactly the values independently verified against the real deployed vault
via `cast call totalSupply()` earlier this session. Same real deposit, same
numbers, decoded two different ways.

Bounded deliberately to a single block (`-t +1`) rather than an open stream:
1.3 KiB egress, 1 block processed — real verification without meaningfully
touching the provisioned API key's usage.
