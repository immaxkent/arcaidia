# WP-31 — Coordinated Sepolia/Arc redeploy + heterogeneous vaults + solvers (M31)

**Objective:** one deployment event, both chains, all v2 contracts; three vaults with different
capital and fee policies; three solver instances; settlement worker on proof. Closes WP-16/WP-20
for real (the live market has never been deployed — plan §K1).

**Depends on:** WP-29 green, WP-30 merged, your keystore + funding. **Blocks:** WP-32, WP-33 live data.

## Sub-tasks

- [ ] **31.1 Dry run.** `forge script script/DeployV2.s.sol --rpc-url ... --sender <deployer>` (no
      broadcast) on both chains; predicted addresses identical across chains for router/receiver/
      market/factory/House Vault; recorded in the WP report before broadcasting.
- [ ] **31.2 Broadcast** (you, or me with you present): Sepolia then Arc. `CircleCCTPInitiator` v2
      per chain, `setDomain` for the opposite chain, router `setDestination` → v2 receiver.
      Authorise: House solver signer on the House Vault; settlement reporter on the receiver (recovery path only).
- [ ] **31.3 Commit `deployments.ts` v2** (+`market`, `vaultFactory`, `houseVault` keys; retire the
      2026-09-10 vault/receiver and the 2026-09-09 router with the same "still settling its own
      intents" note), `.env`/`.env.example`, `apps/web` env, `START_BLOCKS_V2`, regenerate manifests.
- [ ] **31.4 Nest re-seed** (WP-27.4 request sent; verified by live `SELECT` on `vaults`,
      `pending_intents` columns) — or Studio fallback deployed and `SUBGRAPH_URL_*` set.
- [ ] **31.5 Two more vaults via the factory** from *different owner keys* (Vault B, Vault C) with
      the agreed policies/capital; two more solver instances (`docker compose --profile solver-b/c`),
      each with its own signer/submitter and `{PREFIX}_LIQUIDITY_VAULT`.
- [ ] **31.6 Settlement worker v2** running; old worker instance kept until the retired receiver's
      pending intents are drained.
- [ ] **31.7 Live verification, both directions:** frontend intent with `maxFeeBps` → exactly one
      vault fills (telemetry shows the others declining with reasons) → `settleWithProof` tx →
      `LpReimbursed` for that vault. Then one intent with `maxFeeBps = 1` → no fill → fallback via proof.
- [ ] **31.8 WP-20's four checkboxes** ticked with evidence (independent vault path touched no Arcaidia key).

## Acceptance gate

Three heterogeneous vaults live on both chains, each with a solver, competing through the market;
canonical settlement lands via `settleWithProof`; addresses committed; `README.md` "Deployed
addresses" updated.
