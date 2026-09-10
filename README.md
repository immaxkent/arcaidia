# Arcaidia

> Arcaidia is a speed layer over CCTP. Your money goes into Circle's pipe first; an autonomous
> agent verifies that independently, prices the wait, and advances you the destination funds from
> a liquidity vault in seconds. CCTP repays the vault minutes later.

**Agentic Crosschain Intent & Liquidity Network** — ETHOnline 2026 submission.

Arcaidia is not a new canonical bridge, and it adds no trust assumption to the canonical path.
The user's source USDC is committed to CCTP *first*. Only after that commitment is observed
and independently verified may an autonomous liquidity agent advance destination USDC from a
destination-chain LP vault. CCTP then completes asynchronously and replenishes the LP.

The router makes the commitment and the intent atomic, so an `IntentCreated` event cannot exist
without the funds already being in Circle's pipe. That changes the question an LP is answering
from *"will this settlement happen?"* to *"will an already-committed settlement finish?"* — and
the remaining risk is duration, which is exactly what the fee prices.

Turn the solver off and every transfer still completes, at Circle's speed. That fallback is
tested in both directions.

> **Core invariant:** fast settlement accelerates the user experience; canonical settlement
> remains the source of economic finality.

## The one-paragraph version

A user signs in with Privy and expresses an intent ("1,000 USDC on Ethereum → USDC on Arc, to
this recipient, max fee X, by deadline Y"). `ArcaidiaIntentRouter` pulls the USDC and initiates
CCTP in the same transaction, then emits `IntentCreated`. The Graph indexes it. A Liquidity
Agent discovers the intent through The Graph, **independently re-verifies the source receipt via
RPC**, prices the risk deterministically against live vault liquidity / unsettled exposure /
CCTP health, and — if it accepts — has a Circle Agent Wallet sign a short-lived EIP-712
`FillAuthorization`. `ArcaidiaLiquidityVault` on the destination chain verifies that signature,
enforces replay/expiry/caps, and pays the recipient in seconds. Minutes later CCTP delivers
canonical USDC to `SettlementReceiver`, which reimburses the LP vault — or, if nobody fast-filled,
pays the recipient directly as the fallback.

## Non-negotiable design rules

1. **Direction is data, not code.** The same Solidity is deployed on both Ethereum and Arc. The
   solver exposes `processIntent(intent)` — never `processEthToArc()` / `processArcToEth()`.
   `sourceChainId` / `destinationChainId` resolve routers, RPCs and CCTP domains from config.
2. **Two states, never one boolean.** `FAST_FILLED` (user is paid) and `SETTLED` (canonical CCTP
   reconciled) are independent facts and must stay independently observable in the API and UI.
3. **The Graph is observation, never authorization.** It is load-bearing for discovery and live
   risk state, but LP funds only move after independent RPC verification of the source receipt.
4. **Capital-safety decisions are deterministic.** An LLM may explain or summarise a decision;
   it may never be the ACCEPT/REJECT gate. Every branch is unit tested.
5. **Sponsor integrations sit behind adapters.** `ObservationProvider`, `AgentSigner` and
   `SettlementAdapter` each have a local/mock implementation and a sponsor implementation.
   The deterministic local lifecycle goes green *before* sponsors are substituted, one at a time.
6. **Asset selection is configuration.** MockUSDC and real USDC are the same code path
   (`settlementAsset`). No `useRealUSDC` runtime boolean.
7. **CREATE2 same-address deployment** across Ethereum and Arc is a V1 acceptance criterion.
   Identical init code; chain-specific values applied in a post-deploy `initialize`.

## Scope discipline

| Version | Scope | Rule |
| --- | --- | --- |
| **V1** | Ethereum ⇄ Arc USDC fast intent settlement: LP vaults, The Graph, autonomous agents, Circle Agent Wallets, CCTP | Must ship and stand alone. Bidirectional from day one. |
| **V2** | Generalised crosschain swap intents via Uniswap (`desiredToken` + `minimumOutput`, `ExecutionAdapter`) | Only after V1 is frozen and passes end-to-end acceptance. |
| **V3** | Hedera / x402 machine payments for solver & discovery services (`SolverCommerceAdapter`) | Stretch / post-hackathon. |

## Repository layout (target)

```
packages/domain/        # types, config, intent-id, EIP-712, ABIs — no chain-specific logic
contracts/              # Foundry: IntentRouter, LiquidityVault, SettlementReceiver, MockUSDC
packages/agent/         # solver: risk engine, observation, signer, orchestration
packages/settlement/    # settlement agent + CCTP adapter
subgraph/               # The Graph manifests + mappings (Ethereum + Arc)
apps/web/               # Next.js + Privy user application
tests/e2e/              # golden local end-to-end harness
```

## Where the plan lives

- [`docs/Arcaidia_ETHOnline2026_Specification_v4.pdf`](docs/Arcaidia_ETHOnline2026_Specification_v4.pdf) — the authoritative specification.
- [`docs/spec-v4-extracted.txt`](docs/spec-v4-extracted.txt) — greppable text extraction of the same document.
- [`work-packages/`](work-packages/README.md) — the executable build plan: 14 gated work packages (WP-00 … WP-13) mapping to spec milestones M0–M13, each with sub-tasks, tests and an acceptance gate.

## Status

Pre-M0. Nothing is built yet. Start at [WP-00](work-packages/WP-00-domain.md).

## Deployed addresses (frozen, WP-13)

CREATE2 gives every protocol contract the same address on both chains — one table, not two.

| Contract | Address | Chains |
| --- | --- | --- |
| `ArcaidiaIntentRouter` | `0x58868465d14e0694d033bD511588AE90482b21CC` | Ethereum Sepolia, Arc Testnet |
| `ArcaidiaLiquidityVault` | `0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1` | Ethereum Sepolia, Arc Testnet |
| `SettlementReceiver` | `0x9a47a161ea8328b96Ad976264d42790881570E71` | Ethereum Sepolia, Arc Testnet |

The canonical settlement transport (`CircleCCTPInitiator`) is deployed with a plain `new`, not
CREATE2, so it is *not* expected to share an address across chains: Ethereum Sepolia
`0x7C84CB7bb7fB261F579eD5Fc3956c504C640F5Ba`, Arc Testnet `0x0caE5879B7d6f8FB02e7a9D932Ee2CcF267C6ca0`.

An earlier vault/settlement-receiver pair (`0x9F5813cD0Ea34403f78769076043436E67736da3` /
`0xb634d0fDa74BacF730B1eF50a32b4c83f13f11fC`) and an earlier router
(`0x7E4443B9215354e1819ECAA1E4CEDe8A6Fb63357`) are retired — still settling their own
already-pending intents onchain, but no new deposits or fills should target them. See
`packages/domain/src/config/deployments.ts` for the full history.

## Known limitations (disclosed, not gaps)

- **Circle wallet spending-policy CLI refuses on any testnet chain.** `circle wallet limit set` —
  the only documented way to set spending caps or allowlist/blocklist rules on a Circle Agent
  Wallet — is a mainnet-only capability today. It is not required by any targeted bounty's stated
  criteria; it is a real, disclosed constraint of building on testnet, not a gap in the
  implementation, and is expected to be revisited once Arc mainnet is live.
- **Arc mainnet is not yet a supported chain in code**, separately from the contracts themselves
  being deployment-ready. `packages/domain/src/config/chains.ts` / `deployments.ts` are pure data
  and need only a new entry. But the viem chain object itself is currently hand-defined in three
  places (`packages/agent/src/entrypoint/viem-chains.ts`, `packages/settlement/src/entrypoint/viem-chains.ts`,
  `apps/web/src/lib/arcaidia/viem-chains.ts`), each with a matching `if (chainId === ...)` branch
  in its `build-dependencies.ts` (agent, settlement) or `privy-provider.tsx` (web) — plus a new
  subgraph deployment. None of this is a testnet gap; it is simply unbuilt because Arc mainnet
  does not exist yet (launches 2026-09-16). Adding it is small, mechanical, and identical in shape
  across all three copies, but it is real code, not only configuration.
- **Circle Paymaster is not integrated.** Checked directly against Circle's own docs: supported
  networks are Arbitrum, Base, Avalanche, Ethereum, Optimism, Polygon and Unichain — Arc is not
  listed, and Sepolia's status isn't confirmed either. More fundamentally, Paymaster requires an
  ERC-4337 smart contract account; every wallet in this stack (the user's Privy wallet, the
  agent's Circle Agent Wallet) is a plain EOA, so integrating it would mean adding account
  abstraction to the user-wallet path, not wiring up an existing one. Left out deliberately rather
  than attempted under time pressure for a product it may not even run on yet.

## Trust assumption (state this plainly in the demo)

V1 uses an **authorised solver model**. The destination `ArcaidiaLiquidityVault` trusts EIP-712
signatures from allowlisted Circle Agent Wallet addresses, after the agent has independently
verified the source chain. This is a deliberate, disclosed hackathon trust assumption — not a
claim of trustless crosschain verification. Trust minimisation (canonical verification primitives,
quorum attestations, bonded/slashable solvers) is explicitly post-V1.
