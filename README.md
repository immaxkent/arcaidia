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

## Trust assumption (state this plainly in the demo)

V1 uses an **authorised solver model**. The destination `ArcaidiaLiquidityVault` trusts EIP-712
signatures from allowlisted Circle Agent Wallet addresses, after the agent has independently
verified the source chain. This is a deliberate, disclosed hackathon trust assumption — not a
claim of trustless crosschain verification. Trust minimisation (canonical verification primitives,
quorum attestations, bonded/slashable solvers) is explicitly post-V1.
