# Nest re-seed request — Arcaidia v2 (WP-27 / WP-31)

**To:** the Graph rep hosting `https://hackathon.89.167.109.4.sslip.io/arcaidia-sepolia` and
`.../arcaidia-arc`. **From:** Arcaidia. **Why:** the protocol is being redeployed with a new
intent schema (v1.1), per-vault fee policies and a vault factory. The current Nests index the
v1 contracts; after the redeploy every reader (solver, frontend, intelligence API) needs the v2
tables/views below. One re-seed per chain; the v1 Nests can stay up for history.

## Contracts to index (per chain — addresses filled in by WP-31 before sending)

| Data source | Address (Sepolia / Arc — identical, CREATE2) | Start block (Sepolia / Arc) | ABI |
| --- | --- | --- | --- |
| `ArcaidiaIntentRouter` (v2) | `TBD` | `TBD` | `subgraph/abis/ArcaidiaIntentRouter.json` |
| `ArcaidiaVaultFactory` | `TBD` | `TBD` | `subgraph/abis/ArcaidiaVaultFactory.json` |
| `SettlementReceiver` (v2) | `TBD` | `TBD` | `subgraph/abis/SettlementReceiver.json` |
| `ArcaidiaLiquidityVault` — **every address emitted in `VaultCreated.vault`** (a dynamic set; the House Vault and every independent operator's vault) | from the factory's events | same block as its `VaultCreated` | `subgraph/abis/ArcaidiaLiquidityVault.json` |

The reference manifest with exact event signatures is `subgraph/subgraph.<chain>.yaml`
(generated from the ABIs; the vault is a `templates:` entry there). If the Nest cannot follow a
dynamic set, please index the vault addresses we list at re-seed time and tell us how to add
more later — new vaults will be created continuously during the demo.

## Raw event tables (same naming as today)

`intent_router__intent_created` (now with `intentVersion`, `tokenOut`, `targetMinOut`),
`vault_factory__vault_created` (with the `policy` tuple flattened to
`policy_baseFeeBps … policy_criticalThresholdBps`), `liquidity_vault__fast_filled` (+ `feeBps`),
`liquidity_vault__delivered_via_swap`, `liquidity_vault__swap_fell_back`,
`liquidity_vault__deposit`, `liquidity_vault__withdraw`, `liquidity_vault__reimbursement_recorded`,
`liquidity_vault__fees_accrued`, `liquidity_vault__paused_set`, `settlement_receiver__lp_reimbursed`
(3 params now), `settlement_receiver__recipient_paid_by_fallback`,
`settlement_receiver__settled_with_proof`, `settlement_receiver__held_for_vault`.

## Views the readers use (columns are what `packages/agent`, `apps/web`, `packages/relay` select)

- `intents` / `pending_intents`: existing columns **plus** `intent_version`, `token_out`,
  `target_min_out`. **Bug to fix in the same pass:** `nonce` is `NULL` on every row today (the
  `_dec` companion overflows for full-width uint256 nonces); please expose the raw hex/decimal
  string so the solver's raw-table workaround can be removed.
- `vaults` (plural — one row per factory vault): `id`, `owner`, `label`, `created_at_block`,
  `created_at_timestamp`, the seven policy columns, `reserve_floor_bps`, `max_fill_bps`,
  `max_exposure_bps`, `liquid_balance`, `outstanding_exposure`, `accrued_protocol_fees`,
  `utilisation_bps`, `current_fee_bps`, `fill_count`, `total_fees_earned`, `paused`,
  `updated_at_block`. (`vault` singular may remain as an alias of the House Vault row.)
- `fills`: existing **plus** `vault`, `fee_bps`, `fee_amount`, `input_amount`, `delivered_via`
  (`USDC|SWAP|SWAP_FALLBACK`), `token_out`, `amount_out`.
- `settlements`: existing **plus** `via_proof`, `cctp_nonce`, `held_for_vault`; `outcome` gains
  `HELD_FOR_VAULT`.
- `fee_snapshots`: `vault`, `utilisation_bps`, `fee_bps`, `liquid_balance`,
  `outstanding_exposure`, `block_number`, `timestamp` — one row per vault state change.
- `protocol_state`: existing **plus** `vault_count`, `trade_intents_created`, `intents_fallen_back`.

Derivations for `utilisation_bps`/`current_fee_bps` are in `subgraph/src/fee-policy.ts` (four
tiers; thresholds compared with `>=`).

## What stays the same

`/ready`, `/sql?q=`, CORS, the `degraded`/`truncated` envelope, the 503 concurrency cap
behaviour, and the endpoint URLs (unless you prefer new ones — tell us and we'll set
`SUBGRAPH_URL_*`).
