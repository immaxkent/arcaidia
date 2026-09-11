# WP-27 — Indexing migration: subgraph schema, mappings, Nest re-seed (M27)

**Objective:** once the v2 events are locked (WP-25/26 compile), the Graph entity model exposes
every field solvers need, discovers factory-created vaults dynamically, and the Nest is re-seeded
to match — without touching the mappings again afterwards.

**Depends on:** WP-25, WP-26 (ABIs). **Blocks:** WP-28 (Nest provider), WP-30. **Stack:**
`subgraph/`, `scripts/generate-subgraph.ts`, external Nest re-seed.

## Sub-tasks

- [x] **27.1 `schema.graphql`.** `Intent` +`intentVersion: Int!`, `tokenOut: Bytes!`, `targetMinOut: BigInt!`,
      `isTradeIntent: Boolean!`. `Fill` +`feeBps: Int!`, `feeAmount: BigInt!`, `vault: Bytes!`,
      `deliveredVia: DeliveryPath!` (`USDC | SWAP | SWAP_FALLBACK`). `Vault` +`owner`, `label`,
      `createdVia: VaultOrigin!` (`FACTORY | EXTERNAL`), the seven `FeePolicy` fields,
      `maxFillBps`, `maxExposureBps`, `reserveFloorBps`, `currentFeeBps: Int!` (maintained on every
      state-moving event from the policy + utilisation, same arithmetic as `FeePolicyLib`),
      `utilisationBps: Int!`. `Settlement` +`viaProof: Boolean!`, `heldForVault: Bytes`.
      `ProtocolState` +`vaultCount`, `intentsFallenBack`, `tradeIntentsCreated`. New
      `FeeSnapshot @entity(immutable: true)` `(vault, utilisationBps, feeBps, timestamp)` per state change —
      the "fee evolution" series the brief and WP-33 need without query-time recompute.
- [x] **27.2 Mappings.** `router.ts` v2 event; `factory.ts` → `handleVaultCreated` creates the
      `Vault` with policy and instantiates the `ArcaidiaLiquidityVault` **template**; `vault.ts`
      handles `FastFilled` v2, `DeliveredViaSwap`, `SwapFellBack`, maintains `currentFeeBps`,
      `utilisationBps`, `FeeSnapshot`; `settlement.ts` handles `SettledWithProof`, `HeldForVault`,
      keeps `LpReimbursed`/`RecipientPaidByFallback`.
- [x] **27.3 `generate-subgraph.ts` v2.** Data sources: router v2, factory, receiver v2, template
      for vaults. **Event signatures are now derived from the compiled ABIs** (`eventSignature`),
      after finding the committed manifest still carried the 2-param `LpReimbursed` from before
      WP-16 — a hand-typed string nothing could check. **Retired v1 sources dropped, deliberately:**
      v1 history stays queryable on the existing Nests until re-seed, the demo dataset is produced
      on v2, and carrying v1 ABI snapshots + duplicate mappings was a day we don't have. Router v2,
      factory, receiver v2 (+ the retired receivers as today), template for vaults. `START_BLOCKS_V2` filled by WP-31 (placeholder
      `0` until then — `--check` tolerates unset v2 blocks before deploy). `pnpm subgraph:generate && graph codegen && graph build` green.
- [x] **27.4 Nest re-seed request.** One file `subgraph/nest/RESEED-v2.md`: ABIs (paths), addresses
      (from WP-31), start blocks, the views the readers need — `pending_intents`/`intents`
      (+`intent_version, token_out, target_min_out`; **and the existing `nonce` NULL bug**, so
      `sql-nest-observation-provider.ts`'s workaround can go), `vaults` (plural; per-vault rows keyed
      `id` = address, all policy columns, `current_fee_bps`), `fills` (+`vault, fee_bps, fee_amount`),
      `settlements` (+`via_proof`), `fee_snapshots`. Sent to the Graph rep by you (see plan §"What I need").
- [x] **27.5 Fallback path documented:** deploy the same subgraph to Studio for both chains
      (`SUBGRAPH_URL_*` overrides) if the Nest cannot be re-seeded in time; `GraphObservationProvider`
      stays alive for exactly this reason and gets the v1.1 fields too (WP-28).

## Tests

- [x] `scripts/generate-subgraph.test.ts` — factory + template sections, placeholders, ABI-derived signatures incl. tuples.
- [x] `graph codegen` + `graph build` green for both manifests (router, factory, receiver, vault template all compile).
- [ ] Matchstick is not in the repo; keep the existing pattern: `graph build` + a live query
      checklist after WP-31 (`FeeSnapshot` count > 0, `Vault.createdVia == FACTORY` for all three).

## Acceptance gate — met 2026-09-11 (live query checklist pending WP-31)

`pnpm subgraph:check` and `graph build` green for both manifests; the enriched `Intent` entity
carries `maxFeeBps`, `tokenOut`, `targetMinOut`; a factory-created vault appears in the store
without editing the manifest; the re-seed request is complete enough that no follow-up is needed.
