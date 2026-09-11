# WP-30 — Frontend migration (M30)

**Objective:** users set a real, explicit max fast-fill fee; vault creators configure a fee
policy and deploy through the factory; trade-intent fields exist behind a flag. Built once,
against frozen ABIs (WP-24–26) and the frozen index schema (WP-27).

**Depends on:** WP-26 ABIs, WP-27 schema, WP-29 green. **Blocks:** WP-31 demo. **Stack:** `apps/web`.

## Sub-tasks

- [x] **30.1 Transfer.** `use-intent.tsx` calls `createIntent` v2 (`tokenOut = 0x0`, `targetMinOut = 0`
      unless trade mode); decodes `IntentCreated` v2. `transfer-form.tsx`: the existing bps control
      stays as **"Maximum fast-fill fee"** with a plain-language explainer ("solvers that would
      charge more simply won't fill; you still receive USDC via CCTP"); shows the live vault-quoted
      fee from `POST /quote` v2 next to it and marks the choice red when below every visible vault's
      current fee. The submitted `maxFeeBps` is displayed verbatim.
- [x] **30.2 Trade intent fields** behind `VITE_TRADE_INTENTS_ENABLED`: `tokenOut` select from
      `SWAP_INFRASTRUCTURE` markets, `targetMinOut` input with the adapter quote; hidden entirely
      when the flag is off or `markets` is `null`. Types in `lib/arcaidia/types.ts` gain the fields now.
- [x] **30.3 Earn / Create vault.** Fee policy tiers — four fee fields + three threshold fields with
      sensible defaults and a tier preview — placed with the existing risk-exposure sliders, all
      before **Deploy vault**; Deploy = `ArcaidiaVaultFactory.createVault(...)` tx; `vaultAddress`
      from `VaultCreated`; `factoryReady` = `VITE_VAULT_FACTORY_*` set (WP-31). The page says the
      policy is immutable and belongs to *this* vault.
- [x] **30.4 Directory + console.** `use-vaults.ts` from `vaults`/`VaultCreated` (Nest/subgraph),
      not from fills; vault cards show policy tiers, `currentFeeBps`, utilisation; Console shows the
      fee-evolution series from `fee_snapshots`; Liquidity's ecosystem chart unchanged.
- [x] **30.5 `use-intent-history.ts` / `use-vault-fills.ts`** read the new columns; docs page lists v2 addresses.

## Tests

- [ ] `pnpm test:web` + typecheck; browser verification of transfer (max fee submitted on chain
      equals UI value — read back from the event) and vault creation (against anvil or testnet post-WP-31).

## Acceptance gate — met at unit level 2026-09-11; live wallet flows verified at WP-31

A real wallet creates a v1.1 intent with an explicit `maxFeeBps`; a real wallet creates a vault
with its own fee policy from the Earn page; no "WIRE:" placeholder remains on these two flows.
