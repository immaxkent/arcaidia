# V2 migration plan — intent v1.1, vault fee policies, CCTP metadata, Uniswap/Hedera seams

**Written 2026-09-11 from a full read of `main` at `9396c9f`, plus live `eth_call`s against both
testnets. This is the coordination spec for the next phase. Sections A–L answer the questions the
phase brief asked; the dependency plan, branch plan and "what I need from you" follow.**

Work packages: [WP-24](WP-24-freeze-domain-v1.1.md) … [WP-35](WP-35-hedera-x402-gateway.md).
Line 1 (Uniswap) contract: [LINE-1-UNISWAP-INTERFACE.md](LINE-1-UNISWAP-INTERFACE.md).
Decisions taken here: [DECISIONS.md](DECISIONS.md) D5–D10.

---

## A. Current architecture, as actually implemented

**Contracts (Foundry, `contracts/src`, one bytecode for both chains, CREATE2 via `ArcaidiaDeployer`):**

| Contract | Role | Live on both chains? |
| --- | --- | --- |
| `ArcaidiaIntentRouter` | Source side. `createIntent(recipient, amount, destinationChainId, maxFeeBps, deadline, nonce)` pulls USDC, calls `ISettlementInitiator.initiateSettlement`, emits `IntentCreated` (11 flat params incl. `maxFeeBps`, `settlementRef`). `intentId = IntentLib.computeIntentId(Intent)`. | **Yes** — `0x5886…21CC` (`ROUTER_CCTP_SALT`, 2026-09-09) |
| `CircleCCTPInitiator` | `ISettlementInitiator` over CCTP V2 `TokenMessengerV2.depositForBurn` (no hook, `destinationCaller = 0`, standard finality). | Yes (plain `new`, per-chain address) |
| `ArcaidiaLiquidityVault` | ERC-4626 LP vault. `fastFill(FillAuthorization, sig)`: EIP-712 signer allowlist, expiry, agent nonce, `maxFillBps`/`maxExposureBps`/`maxFeeBps` (owner-set percentages), reserve floor, `ISettlementCheck`. **On `main` also** `market.claimIntent(...)` first (`NoMarketConfigured` otherwise). | **Yes, but the pre-market V1 bytecode** — see K1 |
| `ArcaidiaIntentMarket` | First-valid-fill arbiter: `filledBy[intentId]`, universal `MAX_FEE_BPS = 150` ceiling, settlement check. | **No — never deployed** |
| `SettlementReceiver` | Destination terminus. Reporter-gated `settle(intentId, fallbackRecipient, amount)`: reimburse `market.filledBy` winner via `IFillRegistry.recordReimbursement`, else pay recipient. | Yes, but the V1 shape (`vault()` fixed reference, no `market()`) |
| `IArcaidiaSolverVault` / `IntentOpportunity` | Declared in WP-15; `quote()` **not implemented by any vault**, `IntentOpportunity` unused. | n/a |

**Off-chain (pnpm workspace):** `packages/domain` (types, `computeIntentId`, EIP-712, chain/deployment config — the single source every consumer imports); `packages/agent` (solver: `SqlNestObservationProvider` → `verifySourceTransaction` (independent RPC receipt check) → pure `evaluateIntent` (utilisation fee curve **in the solver's `RiskPolicy`**, user `maxFeeBps` gate, caps) → EIP-712 sign (local key or Circle Agent Wallet) → `fastFill`; `POST /quote`); `packages/settlement` (worker: Iris poll by source tx hash → `receiveMessage` → `settle`); `packages/relay` (telemetry pairing/heartbeats/events, WP-21 vault-flows); `packages/telemetry`, `packages/mcp` (read-only tools over `ObservationProvider`); `apps/web` (TanStack + Privy; Transfer with a real `maxFeeBps` control, Liquidity, Earn (vault deploy UI that assumes a **`vaultFactory` which does not exist**), Console).

**Indexing:** `subgraph/` (one manifest per chain, generated from domain config; fixed addresses for router/vault/receiver; entities `Intent`, `Fill`, `Settlement`, `Vault`, `ProtocolState`); the live read path is **the Nest** — two SQL-over-HTTP indexers hosted by the Graph rep, seeded from our ABIs/addresses/start blocks (views `pending_intents`, `intents`, `vault`, `fills`, `settlements`, `protocol_state`, raw `intent_router__intent_created` etc.). `substreams/erc4626-vault-flows` is deliberately generic ERC-4626 and Arcaidia-agnostic.

**Solver ↔ vault pairing today:** one solver process, one vault per chain, vault address per-instance via `{PREFIX}_LIQUIDITY_VAULT`. Exactly the "Solver A → Vault A" model the brief wants to preserve. There is no coordinator anywhere.

## B. What this phase touches

| Layer | Files | Change kind |
| --- | --- | --- |
| Solidity types/libs | `ArcaidiaTypes.sol`, `IntentLib.sol`, new `IntentHookLib.sol`, new `FeePolicyLib.sol` | **breaking** (intent preimage) |
| Router + initiator | `ArcaidiaIntentRouter.sol`, `CircleCCTPInitiator.sol`, `ISettlementInitiator.sol`, `MockSettlementInitiator.sol` | **breaking** (ABI + event) |
| Vault | `ArcaidiaLiquidityVault.sol`, `IArcaidiaSolverVault.sol`, new `ISwapAdapter.sol`, new `ArcaidiaVaultFactory.sol` | **breaking** (`initialize`, `fastFill`) |
| Receiver + market | `SettlementReceiver.sol` (**breaking** `initialize`, new `settleWithProof`), `ArcaidiaIntentMarket.sol` (no logic change; redeployed because its constructor binds the receiver) |
| Deployment | `ArcaidiaDeployment.sol` (new `deployAllV2`), new `script/DeployV2.s.sol`, `packages/domain/src/config/deployments.ts` |
| Domain (TS) | `types/intent.ts`, `intent-id.ts`, `types/settlement.ts` (`VaultState`), `types/risk.ts`, `types/decision.ts`, `ports.ts` (+`SwapAdapter`, `IntelligenceProvider`), `abis.ts`, new `config/markets.ts`, `test/fixtures.ts` |
| Agent | `evaluate-intent.ts`, `fee.ts`, `process-intent.ts`, `build-quote.ts`, `sql-nest-observation-provider.ts`, `graph-observation-provider.ts`, `viem-fill-submitter.ts`, `solver/ports.ts`, `entrypoint/*` |
| Settlement | `circle-cctp-adapter.ts` (complete via `settleWithProof`), `viem-receiver-client.ts`, `discover-settlements.ts`, `process-settlement.ts` |
| Subgraph | `schema.graphql`, `src/*.ts`, `scripts/generate-subgraph.ts` (factory + vault template), Nest re-seed (external) |
| Relay | new `intelligence/` (WP-33) |
| Web | `use-intent.tsx`, `transfer-form.tsx`, `earn.tsx`, `use-vaults.ts`, `use-owned-vaults.ts`, `use-intent-history.ts`, `use-market-intelligence.ts`, `abis.ts`, `config.ts`, `types.ts` |
| E2E | `tests/e2e/src/deploy.ts`, `harness.ts`, `intent.ts`, new tests |
| New packages | `packages/loadgen` (WP-32) |

**Untouched:** `substreams/` (generic), `packages/telemetry`, `packages/mcp` (types flow through the provider), `ArcaidiaDeployer`, Circle Agent Wallet provisioning (the EIP-712 `FillAuthorization` is byte-identical — see D6), Privy wiring, the Nest hosts themselves (re-seed only).

## C. What already exists and is reused, not rebuilt

- `Intent` already carries `sender, recipient, inputToken, amount, sourceChainId, destinationChainId, maxFeeBps, deadline, nonce` on-chain, in the event, in the subgraph, in the Nest and in the frontend. **`maxFeeBps` is already user-supplied on-chain and already indexed.** It is *not* enforced on the destination chain — that is the gap.
- `IntentLib` ↔ `intent-id.ts` differential fixture (`IntentId.t.sol`, `packages/domain/test/fixtures.ts`) is the exact pattern to extend for v1.1 test vectors.
- `FillAuthorization` + `FillAuthorizationLib` ↔ `eip712.ts`: kept byte-for-byte. Nothing about signing changes.
- `ArcaidiaIntentMarket` first-valid-fill + `filledBy`: exactly the brief's mechanism; kept as is.
- Vault: `utilisationBps()`, `maxFillBps`/`maxExposureBps` live percentages, reserve floor, `ISettlementCheck`, `recordReimbursement` accounting — all kept.
- Solver: `RiskPolicy.utilisationFeeCurve` + `fee.ts` step function is the same 4-tier idea the brief describes — it just lives in the wrong place (solver, not vault). It moves on-chain (WP-26) and the solver reads it (WP-28).
- Frontend: the Transfer form already has a bps control (`maxFeeBps`, default 30) and shows "max payable"; Earn already collects `maxFillBps`/`maxExposureBps` before Deploy and expects a factory; `use-market-intelligence.ts` already declares the x402 endpoint shape and returns `unavailable` until a URL exists.
- Settlement worker already holds the full attested `message` bytes from Iris — everything `settleWithProof` needs.
- Relay already has a Nest client and participant discovery (WP-21) — the natural home for the intelligence surface.

## D. Canonical Intent v1.1

Solidity `struct Intent` / TS `IntentParams`, **in preimage order** (D5):

```
uint8   intentVersion        // = 1 for this schema. First field so any future layout is unambiguous.
address sender
address recipient
address inputToken           // source settlement asset (USDC)
uint256 amount
uint256 sourceChainId
uint256 destinationChainId
uint16  maxFeeBps            // user's hard fast-fill ceiling — NOW enforced on chain (D6)
uint64  deadline
uint256 nonce
address tokenOut             // address(0) = destination settlement asset (USDC). Sentinel, not the USDC address, so the intent is chain-agnostic.
uint256 targetMinOut         // must be 0 when tokenOut == address(0); else min acceptable tokenOut delivered
```

`intentId = keccak256(abi.encode(INTENT_TYPEHASH_V1_1, ...fields in this order))` with
`INTENT_TYPEHASH_V1_1 = keccak256("Intent(uint8 intentVersion,address sender,address recipient,address inputToken,uint256 amount,uint256 sourceChainId,uint256 destinationChainId,uint16 maxFeeBps,uint64 deadline,uint256 nonce,address tokenOut,uint256 targetMinOut)")`.
One implementation in `IntentLib.sol`, one in `intent-id.ts`, four shared vectors (USDC-only, trade intent, mirrored direction, max-width nonce/amount) asserted from both sides. The spec's `desiredToken`/`minimumOutput` names are the brief's `tokenOut`/`targetMinOut`; we use the brief's names everywhere.

Router validation: `tokenOut == 0 ⇒ targetMinOut == 0`; `tokenOut != 0 ⇒ targetMinOut > 0`. Trade intents are **accepted on chain from day one** (they are safe by construction: if no solver can satisfy the swap, canonical settlement delivers USDC to `recipient` exactly as today) and **hidden in the UI** behind `VITE_TRADE_INTENTS_ENABLED` until Line 1 merges.

`IntentCreated` v2 emits every field above plus `settlementRef` (flat params, same three indexed topics: `intentId, sender, recipient`). Solvers need nothing beyond the event.

## E. Fee policy representation (D7)

```
struct FeePolicy {
    uint16 baseFeeBps;          // utilisation <  midThresholdBps
    uint16 midFeeBps;           // utilisation >= midThresholdBps
    uint16 highFeeBps;          // utilisation >= highThresholdBps
    uint16 criticalFeeBps;      // utilisation >= criticalThresholdBps
    uint16 midThresholdBps;     // e.g. 5000
    uint16 highThresholdBps;    // e.g. 7500
    uint16 criticalThresholdBps;// e.g. 9000
}
```
Set once in `initialize` (through the factory), immutable after; validated (thresholds strictly ascending ≤ 10000, fees non-decreasing, `criticalFeeBps ≤ ArcaidiaIntentMarket.MAX_FEE_BPS`). Views: `feePolicy()`, `currentFeeBps()` (tier at the vault's *current* `utilisationBps()`), `quoteFee(uint256 inputAmount) → (feeBps, feeAmount)`. Enforcement inside `fastFill`, evaluated at **pre-fill** utilisation (deterministic, matches what the solver observed):

```
feeAmount <= inputAmount * intent.maxFeeBps / 1e4        // UserFeeCeilingExceeded — the brief's hard requirement
feeAmount <= inputAmount * currentFeeBps() / 1e4         // FeeAbovePolicy — the vault's posted price is a ceiling; a solver may undercut, never overcharge
market.claimIntent(...)                                   // universal 150 bps outer bound, unchanged
```
The solver's `RiskPolicy` keeps only risk knobs (caps, confirmations, settlement backlog). It no longer prices.

## F. CCTP metadata / intent association (D8)

Verified against `circlefin/evm-cctp-contracts@master` today: `TokenMessengerV2.depositForBurnWithHook(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, bytes hookData)` appends `hookData` at `BurnMessageV2` offset 228; the message body starts at `MessageV2` offset 148; the attestation covers the whole message; `MessageTransmitterV2.receiveMessage` enforces `destinationCaller` when non-zero.

- **Source:** router builds `hookData = IntentHookLib.encode(HOOK_VERSION=1, intentId, recipient)` (`abi.encode(uint8,bytes32,address)`, 96 bytes) and passes it through `ISettlementInitiator.initiateSettlement(..., bytes hookData)`. `CircleCCTPInitiator` v2 calls `depositForBurnWithHook` with `destinationCaller = destinationReceiver`.
- **Destination:** `SettlementReceiver.settleWithProof(bytes message, bytes attestation)` — **permissionless** — parses `mintRecipient == this`, `amount`, `feeExecuted`, hookData → `(intentId, recipient)`, calls `MessageTransmitterV2.receiveMessage` itself (only it can, because it is the `destinationCaller`), checks the USDC balance delta, then routes exactly as `settle` does today (`market.filledBy` winner → `recordReimbursement`; else pay `recipient`). One transaction replaces today's two, and the reporter's asserted `amount`/`fallbackRecipient` disappear — both now come from Circle-attested bytes. Reporter-gated `settle` is retained only as an owner recovery path.
- **Fast path unchanged and CCTP-independent:** solver reads `IntentCreated` (via the Nest/subgraph), verifies the source receipt by RPC, evaluates, fills. It never touches Iris.

## G. Breaking changes

1. `intentId` preimage (v1 ids ≠ v1.1 ids — fine, new router).
2. `ArcaidiaIntentRouter.createIntent` args + `IntentCreated` event + `quoteIntentId`.
3. `ISettlementInitiator.initiateSettlement` gains `hookData` (mock + Circle initiators).
4. `ArcaidiaLiquidityVault.initialize` (caps + fee policy), `fastFill(Intent, FillAuthorization, sig)`, removal of `setFillLimits`'s `maxFeeBps` (policy replaces it), new views; `FastFilled` event gains `feeBps`.
5. `SettlementReceiver.initialize` (+`messageTransmitter`), new `settleWithProof`.
6. `IArcaidiaSolverVault`: `quote(Intent)` replaces `quote(IntentOpportunity)`; `IntentOpportunity` deleted (never used).
7. TS: `IntentParams` (+3 fields — every literal `Intent` in fixtures/`build-quote`/web breaks at compile time, which is the point), `VaultState` (+`feePolicy`, `currentFeeBps`), `FillSubmitter.submitFastFill` (+`intent`), `RiskPolicy` (fee fields removed), `DecisionReason` (+`TRADE_NOT_SUPPORTED`, `FEE_ABOVE_VAULT_POLICY`).
8. Subgraph schema (`Intent` +3, `Vault` + policy fields, new `VaultCreated` source + template), Nest views (+ columns).
9. Web ABI/types mirror.

**Not breaking:** `FillAuthorization` / EIP-712 domain / Circle Agent Wallet; `ArcaidiaIntentMarket` ABI; `IFillRegistry`; `ISettlementCheck`; telemetry/relay wire formats; substreams.

## H. Required redeployments (one coordinated event, WP-31)

Both chains, new salts `arcaidia.v2.*`: `ArcaidiaIntentRouter`, `CircleCCTPInitiator` (plain `new`), `SettlementReceiver`, `ArcaidiaIntentMarket`, `ArcaidiaVaultFactory`, then vaults **through the factory** (House Vault + ≥2 heterogeneous vaults). Untouched: `ArcaidiaDeployer`, USDC, CCTP, retired contracts. The old router/receiver/vault keep settling their own in-flight intents (keep one settlement-worker instance pointed at the old receiver until drained — a config, not code).

**This redeploy is already owed:** K1 below. Folding fee policy + hook + factory into it means one vault redeploy, not two.

## I. Parallelisable workstreams

| Track | Starts after | Owner |
| --- | --- | --- |
| Line 1 Uniswap env + `UniswapV2SwapAdapter` (`v2-uniswap`) | WP-24 lands `ISwapAdapter` (hours, not days) | separate agent |
| WP-27 Graph/Nest | WP-25/26 ABIs compile (before their tests are green) | me |
| WP-32 loadgen | WP-24 (bots only call `createIntent`) | me, interleaved |
| WP-33 intelligence surface | now (Nest v1 schema), extended after WP-27 | me |
| WP-30 frontend | WP-24–26 ABIs frozen + WP-27 schema | me, late |
| WP-35 Hedera | WP-33 endpoint stable | later / separate instructions |

## J. Dependency-ordered plan

```
WP-24 freeze domain v1.1 ─┬─> WP-25 router+hook ──┐
                          ├─> WP-26 vault+factory+receiver ─┤
                          │        (ABIs) ─> WP-27 Graph/Nest ─┤
                          │                                     ├─> WP-28 solver+settlement ─> WP-29 integration gate
                          ├─> [Line 1: v2-uniswap] ────────────┘                                        │
                          └─> WP-32 loadgen (code only)                                                 v
                                                                          WP-30 frontend ─> WP-31 coordinated redeploy + multi-vault
                                                                                                        │
                                                                              WP-32 run load ─> WP-33 intelligence ─> WP-35 Hedera
                                                                              WP-34 Uniswap execution merge (adapter set on vault, no redeploy)
```
Deployment is delayed until WP-29 is green. Frontend is delayed until WP-27's schema is final.

## K. Risks and contradictions with the current system

1. **The intent market on `main` has never been deployed.** Live `eth_call market()` reverts on the vault at `0xc74E…AAF1` on both chains; the receiver still exposes `vault()`. WP-16 wired the market into the vault on 2026-09-11, one day *after* `DeployVaultV2` (2026-09-10). WP-20 is fully unchecked. Consequence: the live testnet runs V1 single-vault; every "permissionless market" claim is test-only until WP-31. This plan's redeploy closes WP-16/WP-20 as a side effect.
2. **WP-INTENT-MARKET.md §6 decided *not* to propagate `maxFeeBps` on-chain.** The brief reverses that. Resolution (D6): the vault recomputes `intentId` from the canonical intent it is handed, so the enforced `maxFeeBps` is provably the one the id denotes. This is *not* trustless proof the intent exists on the source chain — that remains the verified-observation model — it is proof the fee is consistent with the only intent that id can be.
3. **The Nest is external.** Re-seeding after new ABIs/addresses requires the Graph rep; dynamic factory-created vaults may need a template the Nest doesn't support. Mitigation: `subgraph/` stays deployable to Studio as fallback; WP-27 produces a one-file re-seed request; the solver's provider already abstracts the transport.
4. **`via_ir = false` + a 14-param event** risks stack-too-deep in `createIntent`. Mitigation in WP-25: dedicated internal emit helper; struct-tuple event only as last resort (flat is friendlier to the Nest).
5. **`destinationCaller = receiver` locks the mint to our receiver.** Safe only because `settleWithProof` is permissionless and needs no key. A route that reverts (a hostile winning vault) would strand the mint → WP-26 wraps the vault call in try/catch and parks funds as `HELD_FOR_VAULT`, claimable by the winner, so canonical funds are never trapped.
6. **Universal ceiling vs user ceiling:** keep both; user's binds first now.
7. **`maxFeeBps` in the vault's `setFillLimits` becomes redundant** with the policy; removed rather than left as a second, contradictory ceiling.
8. **20% constrained-liquidity target** is emergent from capital vs load; parameters are config (WP-32) and will need one tuning pass against live data.
9. **Time:** two days. WP-24–31 are the must-ship core; WP-32/33 are what makes the demo/Graph data meaningful; WP-34 (execution merge) and WP-35 (Hedera) are stretch and explicitly separable.
10. **Old in-flight intents** on the retired router must keep settling — worker config for two receivers during the transition (already how the retired receiver is handled in the subgraph).
11. Frontend `Intent` shape is declared "do not change" in `types.ts` — it changes here, deliberately, once.

## L. Interface for the Line 1 (Uniswap) agent — locked now

See [LINE-1-UNISWAP-INTERFACE.md](LINE-1-UNISWAP-INTERFACE.md). Summary: implement `ISwapAdapter` (`quote`, `canSatisfy`, `swapExactInput` pulling `tokenIn` from the caller and delivering `tokenOut` to `recipient`), deploy a V2 AMM + four USDC-paired mock markets per chain, run the two-chain price-rebalancing bot, commit addresses into `packages/domain/src/config/markets.ts` in the shape reserved by WP-24, and never touch the intent schema, the vault, the router or the solver's decision logic.

---

## Branch plan

| Branch | Content | Merges into |
| --- | --- | --- |
| `v2-core` (this branch) | WP-24 → WP-33, chronological commits per sub-task, `pnpm test:global` green at every WP gate | `main` after WP-29 (pre-deploy) and again after WP-31 |
| `v2-uniswap` (Line 1 agent, off `main` after WP-24 is merged or cherry-picked) | AMM, mocks, pools, bot, `UniswapV2SwapAdapter`, `markets.ts` | `main`; then WP-34 on `v2-core` sets the adapter on the vaults |
| `v3-hedera` (later, off `main` after WP-33) | x402 gateway around the intelligence endpoint | `main` |

`main` stays deployable at every point; the live V1 system is not touched until WP-31.

## Testing dependencies (what must be green before what)

- WP-24: `pnpm test:shared-domain` + `forge test` (IntentId vectors both sides).
- WP-25/26: `pnpm test:sc` (both directions) — the brief's contract test list lives in those WPs.
- WP-27: `pnpm subgraph:check` + `graph build`; Nest re-seed verified by live `SELECT`.
- WP-28: `pnpm test:agent`, `pnpm test:settlement`.
- WP-29: `pnpm test:e2e` (two anvil chains, factory, two heterogeneous vault/solver pairs racing, maxFee-too-low → fallback, hook association through the mock initiator) and the full `pnpm test:global`.
- WP-30: `pnpm test:web` + typecheck + browser verification.
- WP-31: live checklist (predicted addresses, `market()`, `feePolicy()`, real intent → fill → `settleWithProof`) in both directions.

## What I need from you

1. **Graph rep contact / Nest re-seed path** (WP-27): new ABIs, addresses, start blocks, factory-created vault discovery. If unavailable within the window, say so and I fall back to Studio subgraph deployments (rate-limited) for the demo solvers.
2. **Keystore broadcasts** (WP-31): `DeployV2.s.sol` on both chains needs `--account deployKey` (your password) — I prepare and dry-run, you (or I, with you present) broadcast.
3. **Testnet funding** (WP-31/32): Sepolia ETH + USDC and Arc USDC for: 3 vault owners' LP deposits (suggest 20k / 8k / 3k USDC per chain), 3 solver signer+submitter pairs, ~6 user-bot wallets. Tell me which keys I may generate vs which you hold.
4. **Fee tier defaults** for the three demo vaults (I propose: House 10/25/60/120 bps @ 50/75/90%; Vault B 15/30/70/140; Vault C 5/20/50/100 — different capital, different curves).
5. **Confirm**: trade intents accepted on chain now, UI-hidden (recommended); universal ceiling stays 150 bps; fee policy immutable after deploy, fill/exposure caps remain owner-adjustable.
6. **Line 1 handoff**: point the Uniswap agent at `LINE-1-UNISWAP-INTERFACE.md` and the `v2-uniswap` branch name.
7. **Hedera instructions**: not in this repo; hand them over when WP-33 is stable.

Everything else in WP-24 → WP-30, WP-32, WP-33 I do without waiting.
