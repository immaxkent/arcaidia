# WP-31 — Coordinated Sepolia/Arc redeploy + heterogeneous vaults + solvers (M31)

**Objective:** one deployment event, both chains, all v2 contracts; three vaults with different
capital and fee policies; three solver instances; settlement worker on proof. Closes WP-16/WP-20
for real (the live market has never been deployed — plan §K1).

**Depends on:** WP-29 green, WP-30 merged, your keystore + funding. **Blocks:** WP-32, WP-33 live data.

## Sub-tasks

- [x] **31.1 Dry run — done 2026-09-11, both chains, `script/Deploy.s.sol` (v2 flow, one script).**
      Predicted, identical on Sepolia and Arc (deployer `0x538e…65b0`, `arcaidia.v2.*` salts):
      router `0x69946FFBBE5f250C7357b89E4072F9eAfc1c3ee6` · House Vault
      `0xB4bA190D5C78869366e7963f5CcCf4c3167d855C` · receiver `0x8B93b54d6Df61E9422D14C309F3c9Ab950b920Cd`
      · market `0x81d94f5149FC86df7A273A720070300C461DcA08` · factory
      `0xD458d83C874296EC4a29c47655Ae47302879b23a`. Per-chain `CircleCCTPInitiator` v2 (plain `new`, nonce-dependent — take the address from the
      broadcast log, the dry run's `0x01F7…b827` / `0x6095…d9b3` shift with any prior tx).
      ~17.6M gas Sepolia (≈0.018 ETH at ~1 gwei), ~18.1M gas Arc (≈0.40 USDC-gas), initiators included.
      **Found:** a stale `DESTINATION_SETTLEMENT_RECEIVER` in `.env` (the retired 2026-09-08
      receiver) would have pointed both v2 routers at a dead contract — the script now refuses any
      value that is not the predicted v2 receiver (`ALLOW_FOREIGN_DESTINATION_RECEIVER=true` to
      override, never on these two chains). Addresses change if any contract bytecode changes
      before the broadcast — re-run the dry run last.
- [ ] **31.2 Broadcast** (you — the `deployKey` keystore): Sepolia then Arc. One run per chain does
      everything: fresh `CircleCCTPInitiator` v2 + `setDomain(other chain)`, the five CREATE2 contracts,
      House Vault through the factory with the env fee tiers, router `setDestination` → v2 receiver,
      reporter granted, **House solver signer (`CIRCLE_AGENT_WALLET_ADDRESS`) authorised in the same
      run** (owner == broadcaster). See the runbook below.
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

## Runbook (2026-09-11)

**Before broadcasting (you):**
1. **`contracts/.env`** (Foundry auto-loads this file, not the root `.env`): the three v1 values
   `DESTINATION_SETTLEMENT_RECEIVER`, `SETTLEMENT_INITIATOR_ETHEREUM_SEPOLIA`,
   `SETTLEMENT_INITIATOR_ARC_TESTNET` are already commented out (done 2026-09-11 with a dated
   note; the script derives the v2 ones and refuses the stale receiver). Check
   `SOLVER_SIGNER_ADDRESS` there is the address the House solver really signs with (it resolved to
   the Circle Agent Wallet `0x6B73…3424` in the dry run).
   Keep `PROTOCOL_OWNER`, `PROTOCOL_TREASURY`, `SETTLEMENT_REPORTER`, `RESERVE_FLOOR_BPS`,
   `PROTOCOL_FEE_SHARE_BPS`, `MAX_INTENT_AMOUNT`, `MAX_IN_FLIGHT_VALUE`, `CIRCLE_AGENT_WALLET_ADDRESS`.
   Optional overrides: `FEE_{BASE,MID,HIGH,CRITICAL}_BPS`, `FEE_{MID,HIGH,CRITICAL}_THRESHOLD_BPS`,
   `MAX_FILL_BPS`, `MAX_EXPOSURE_BPS`, `HOUSE_VAULT_LABEL`.
2. Gas: deployer `0x538e…65b0` holds ~0.029 ETH on Sepolia (need ≈0.017 at 1 gwei — top up to ≥0.1
   for headroom) and ~49.7 USDC-gas on Arc (plenty).
3. Testnet USDC for LP capital: deployer holds 280 USDC (Sepolia) / 49.7 USDC (Arc). Three vaults ×
   two chains at demo-meaningful sizes needs more — Circle faucet, several wallets/days.

**Broadcast (you):**
```bash
cd contracts && set -a && source ../.env && set +a && forge script script/Deploy.s.sol --rpc-url https://ethereum-sepolia-rpc.publicnode.com --account deployKey --sender 0x538e5E9797fa86eE25e97289439b6A3AbA0165b0 --broadcast -vv
```
```bash
cd contracts && set -a && source ../.env && set +a && forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.io --account deployKey --sender 0x538e5E9797fa86eE25e97289439b6A3AbA0165b0 --broadcast -vv
```

**After the broadcasts (me, no input needed):** `deployments.ts` v2 + retirement notes, `START_BLOCKS`
from the receipts, manifests regenerated, README addresses, `.env`/`.env.example`, Nest re-seed
request filled in (`subgraph/nest/RESEED-v2.md`) for you to forward, Studio subgraph build ready as
the fallback, LP deposit + Vault B/C creation scripts for the operator keys, settlement worker v2
config, live fill → `settleWithProof` verification in both directions.

**Then (you):** forward the re-seed request to the Graph rep; deposit House Vault capital
(`deposit` from the owner wallet, or tell me the LP key holder); fund two operator wallets (I'll
generate `.env.solver-b` / `.env.solver-c` — gitignored — and print the addresses to fund).

## Acceptance gate

Three heterogeneous vaults live on both chains, each with a solver, competing through the market;
canonical settlement lands via `settleWithProof`; addresses committed; `README.md` "Deployed
addresses" updated.
