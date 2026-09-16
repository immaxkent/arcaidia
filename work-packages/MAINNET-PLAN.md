# Arcaidia Mainnet Plan — Ethereum Mainnet ↔ Arc Mainnet

Source of findings: [`docs/MAINNET_READINESS.md`](../docs/MAINNET_READINESS.md). A work package is
done when its gate is evidenced by passing tests or on-chain reads, never when code looks done.

**Decisions recorded 2026-09-16**

- Launch route: Ethereum Mainnet ↔ Arc Mainnet only.
- Protocol owner: a Safe on each chain. Pausing stays an owner action through the Safe; no separate guardian role for now.
- Launch scope: USDC transfers only. Trade intents off. Uniswap adapter not set. Hedera intelligence off.

---

## M0 — Launch blockers

| WP | Fixes | Change | Gate |
|---|---|---|---|
| **MN-01 Authenticated settlement** | B-1 | `CircleCCTPInitiator` accepts calls only from its router, fixed at construction. `CctpMessageLib` also parses `sourceDomain` and the burn's `messageSender`. `SettlementReceiver` settles only when that pair matches a set-once trusted `(domain → initiator)` entry. | Both spoofed-hook PoCs and the initiator PoC inverted; fuzz over random sender and domain; fork test parsing a real `MessageSent` from Ethereum mainnet |
| **MN-02 One wiring unit** | B-2 | Receiver, market and factory are deployed and wired together. `fastFill` reverts `ReceiverMismatch` unless the vault's receiver equals `market.settlementCheck()`. | Stale-wiring PoC inverted; deployment test asserts all seven equalities in both directions |
| **MN-03 Safe deployment** | B-3 | Receiver initialised in its deploy transaction. `ArcaidiaDeployer` usable only by its owner. New `arcaidia.mainnet.v1.*` salts. Routers get `setDestination` only after the other chain passes verification. | Front-run and squatting PoCs inverted; every contract `initialized()` right after its own deploy |
| **MN-04 Remove reporter path** | B-4 | Delete `settle()` and the reporter role from the receiver. | Reporter PoCs deleted with the function; no reporter code left |
| **MN-05 Stuck-funds exits** | C-09, C-10 | A failed fallback payment parks for the attested recipient with a permissionless retry. A vault accepts a below-principal reimbursement and books the shortfall as a loss. | Blocklist PoC inverted; fuzz: exposure clears and share price falls by exactly the shortfall |
| **MN-06 Rolling intake cap** | B-9 (cap) | Replace the ever-growing `totalInFlight` with a rolling 24-hour volume cap that resets on its own. | PoC inverted; volume above the cap succeeds in the next window |
| **MN-07 Two-step ownership** | C-20, part of B-7 | `transferOwnership` sets a pending owner; the Safe calls `acceptOwnership`. | Unit tests per contract |
| **MN-08 External review** | MN-01 to MN-07 | Independent review of the Solidity diff. | Report received; every finding fixed or accepted in writing |
| **MN-09 Finality-aware solver** | B-5, C-12 | Ethereum-sourced intents wait for the `finalized` block. The solver decodes `DepositForBurn` in the source receipt and checks receiver, domain, amount and hook. Arc stays at 1 confirmation. | Unit tests for each rejection path |
| **MN-10 Mainnet manifest** | B-6 | `contracts/deploy/mainnet.json` holds only verified addresses. Scripts use no defaults and revert on unknown chains. A post-deploy script asserts CCTP domains, messengers and USDC decimals. Router deployed with trade intents off. | Fork dry-run on both chains passes every assertion |
| **MN-11 Roles** | B-7 | Safe owns protocol contracts; separate treasury; Circle wallet signs for the House Vault; hot keys only relay and settle. | On-chain owner and role reads match the plan |
| **MN-12 Production profile** | B-8 | `ARCAIDIA_NETWORK=mainnet` with no default. Mainnet build excludes loadgen, market bot, demo solvers, mock tokens, x402 and the hackathon indexer. Own subgraphs on networks `arc` and `mainnet`. | CI fails if a mainnet artifact contains a testnet chain id, `sandbox`, `sslip.io`, `hedera:testnet`, `Mock` or `loadgen` |
| **MN-13 Re-attestation** | B-9 (expiry) | Settlement worker calls `POST /v2/reattest/{nonce}` when a message has expired, then resubmits. | Adapter test with stubbed Iris responses |
| **MN-14 Launch** | — | Deployment runbook (report §G) and staged launch (report §H). | Every stop/go row in report §H passes |

**M0 exit:** 7 consecutive days and 50 round trips at launch limits with zero HELD, zero double payments and quiet alerts.

---

## M1 — Uniswap integrated, trades still off

| WP | Change | Gate |
|---|---|---|
| **UN-01 Adapters** | Deploy `UniswapV2SwapAdapter` per chain against the official Router02 (Arc `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`, Ethereum `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`; re-verify on the day). Safe owns them; no pairs allowed. | `router()` and `factory()` match the manifest |
| **UN-02 Pair vetting** | A token passes only if it is a plain ERC-20, has a USDC pool deeper than a set threshold, and a 1% sell moves price less than a set bound. Record each pass. | Script output per candidate pair |
| **UN-03 Quotes and prices** | Price API and Trade page read real pools. Mock markets and the market bot are removed from every profile that points at mainnet. | Trade page quotes match `getAmountsOut` on chain |
| **UN-04 Solver trade policy** | Solver quotes trade intents with `canSatisfy`, applies a per-pair size cap and a pool-depth floor, and still rejects every trade while trades are off. | Unit tests; shadow-mode logs show would-be decisions |
| **UN-05 Adapter on House Vault** | Safe calls `setSwapAdapter` on each House Vault. Harmless while the router refuses trade intents. | `swapAdapter()` read; USDC intents unchanged |

**M1 exit:** 14 days of shadow quoting with fewer than 2% of would-be fills failing their own `targetMinOut` against real pools.

## M2 — Trade intents on

| WP | Change | Gate |
|---|---|---|
| **TR-01 Forced-fallback guard** | Vault requires a minimum gas reserve before calling the adapter, so a relayer cannot force USDC delivery. | Test with a starved-gas call reverts instead of falling back |
| **TR-02 One pair first** | Safe allows one vetted pair on one chain and calls `setTradeIntentsAllowed(true)`, with a per-pair cap in the solver. | First 20 trade intents deliver `tokenOut` or exact USDC fallback |
| **TR-03 Monitoring** | Alert on `SwapFellBack` rate, adapter reverts and slippage against quote. | Alerts fire in a staged test |
| **TR-04 Widen** | Add pairs one at a time through UN-02, then open the second chain. | Same stop/go as TR-02 per pair |

**M2 exit:** fallback rate under 5% over 7 days with no loss events. Kill switch: `setTradeIntentsAllowed(false)` from the Safe.

## M3 — Hedera intelligence as an opt-in upgrade

Hedera never touches contracts or settlement. It stays a solver option that withholds fills and never grants them (decision D13).

| WP | Change | Gate |
|---|---|---|
| **HD-01 Ship dormant** | The mainnet solver image already contains the intelligence code from M0. With `INTELLIGENCE_URL` unset it loads no Hedera dependency and makes no request. | Test: image runs with no Hedera env and no outbound x402 calls |
| **HD-02 Network as config** | Replace hardcoded `hedera:testnet` with `HEDERA_NETWORK`, plus a per-hour spend cap. | Unit tests for both networks and the cap |
| **HD-03 Mainnet gateway** | Run the x402 gateway on Hedera mainnet with a production facilitator, versioned `/v1/` routes, reading mainnet indexer data. | Paid request settles on Hedera mainnet; receipt verifies |
| **HD-04 Operator release** | Publish a tagged solver release with a changelog. Enabling is four env values: `INTELLIGENCE_URL`, `INTELLIGENCE_MODE`, `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY`. | A fresh operator enables it from the release notes alone |
| **HD-05 Fail-open proof** | Gateway down, slow or wrong leaves every solver decision unchanged. | Chaos test: decisions identical with the gateway killed |

**M3 exit:** at least one independent operator runs with intelligence on for 7 days with no change to settlement outcomes.

---

## Order

```
M0 (MN-01…MN-14) ──> M1 (UN-01…UN-05) ──> M2 (TR-01…TR-04)
        └────────────> M3 (HD-01 ships inside M0; HD-02…HD-05 any time after M0 exit)
```
