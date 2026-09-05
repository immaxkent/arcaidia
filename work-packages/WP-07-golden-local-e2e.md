# WP-07 — Golden local E2E (M7)

**Objective:** one command executes the entire economic lifecycle, deterministically, with no
sponsor service running. **This is the most important gate in the project.**

**Depends on:** WP-06. **Blocks:** WP-08, WP-09, WP-10.
**Stack:** Foundry (anvil ×2), Vitest integration harness.

## Sub-tasks

- [x] **7.1 Two local chains.** Spin up two anvil instances with distinct chain IDs standing in
      for Ethereum and Arc. Deploy the same contracts via CREATE2 to both; assert identical addresses.
- [x] **7.2 Seed.** Mint MockUSDC, fund LP vaults on both chains, fund a user wallet, configure
      the risk policy.
- [x] **7.3 The golden run:** create intent → observe (InMemoryObservationProvider) → verify via
      RPC → evaluate → sign (LocalAgentSigner) → fast-fill → canonical settle (MockSettlementAdapter)
      → reimburse LP → final state `FAST_FILLED + SETTLED`. Assert balances at **every** step,
      including that the vault ends up ahead by exactly the fee.
- [x] **7.4 Mirror run.** The identical script with source and destination swapped, driven purely
      by config. Same assertions.
- [x] **7.5 Fallback run.** No solver participates → canonical settlement pays the recipient.
      Both directions.
- [x] **7.6 Rejection runs.** Insufficient liquidity, fee ceiling breached, exposure cap hit,
      CCTP unavailable → PAUSE. Assert no funds moved.
- [x] **7.7 One command.** `pnpm e2e` does all of it from a clean machine — no manual steps,
      no external network. Document it in the README.
- [x] **7.8 CI.** GitHub Actions running contract tests, unit tests and the golden E2E on every push.
- [x] **7.9 Invariant checklist run.** The ten global invariants from the index, as an executable
      suite, green here and re-run at every later gate.

## Acceptance gate

The complete economic lifecycle passes deterministically before any external sponsor integration
is required. Green in CI, from clean, in both directions.

## Why this gate matters most

Everything after this replaces one mock with one sponsor service. If the golden E2E is solid, a
sponsor outage during the hackathon costs you one integration, not the submission. If it is not
solid, every later failure is ambiguous — you will not know whether the bug is yours or Circle's.
**Do not start WP-08 with this red.**
