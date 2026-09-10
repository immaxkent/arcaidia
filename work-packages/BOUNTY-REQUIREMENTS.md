# ETHOnline 2026 — bounty requirements and evidence map

Sourced from the public prize pages on 2026-09-04. Arcaidia is a new project, so
it competes in the **Start Fresh** pool; every Continuity-only prize below is
listed for completeness and marked unavailable.

Each requirement names the artefact that will prove it and the work package that
produces that artefact. WP-12's gate is this table with every row evidenced.

Sources: [Arc](https://ethglobal.com/events/ethonline2026/prizes/arc) ·
[The Graph](https://ethglobal.com/events/ethonline2026/prizes/the-graph) ·
[Privy](https://ethglobal.com/events/ethonline2026/prizes/privy)

---

## Targeted prizes

| Sponsor | Prize | Value | Fit |
| --- | --- | --- | --- |
| Arc/Circle | P2 — Best Agentic Economy Application | $1,667 | **Primary.** Autonomous solver with real decision logic on Arc. |
| Arc/Circle | P4 — Launch on Arc Testnet & Push to Mainnet | $3,500 (1st $2,500) | **Primary.** Largest single Arc prize. See the mainnet note below. |
| Arc/Circle | P1 — Best DeFi/Onchain Finance Application | $1,667 | Secondary; same deliverables, different emphasis. |
| The Graph | P2 — Best AI Tooling or AI Use Case (From Scratch) | $5,000 (1st $2,500) | **Primary.** Agent uses The Graph as its live data source. |
| The Graph | P1 — Best Use of Composable or Standardized Graph Products | $5,000 | **Does not currently qualify** — see gap below. |
| Privy | P2 — Best Financial Flow | $2,500 | **Primary.** Bridging/transfer flow is exactly the listed use case. |
| Privy | P1 — Best B2B Financial Product | $2,500 | Possible with an LP-treasury angle; scope decision. |

Unavailable to us (Continuity track only): Arc P3, Arc P5, The Graph P3.

---

## Two gaps between the prizes and the current plan

### 1. The Graph P1 does not qualify as designed — two routes to fixing that

P1 is explicit: *"Simply querying one Subgraph with no composition or
standardization does not qualify; consider the Best AI Use Case track instead."*
Two per-chain subgraphs merged client-side is exactly that. To qualify we must
either **compose two or more Graph products** or **build meaningfully on a
standardized schema**.

P1 also names the route that fits us best: *"Contributing a new composable
Substreams module for an emerging standard, such as ERC-4626 tokenized-vault
flows, also counts."*

**Route A — Subgraph MCP (cheap).** Compose subgraphs + the Subgraph MCP, either
consumed by the solver or exposed so other agents can query Arcaidia's liquidity
and settlement state in natural language. Low cost, fits the agentic story,
strengthens P2 at the same time.

**Route B — ERC-4626 + a composable Substreams module (heavier, more distinctive).**
Make `ArcaidiaLiquidityVault` an ERC-4626 tokenized vault, then contribute a
reusable Substreams module for ERC-4626 vault flows. This is the named example in
the prize text, and it is the difference between "we used The Graph" and "we
contributed to The Graph's standards".

**ERC-4626 is worth considering on its own merits, independently of the prize.**
LP accounting becomes standard share-based accounting; `totalAssets()` is
`balance + outstandingExposure`, which models the receivable honestly and makes
the fee visible as a rising share price — a genuinely better demo than a balance
that dips and recovers. Costs: share-rounding and donation/inflation attack
surface to test, and `totalAssets()` must never under-report the receivable or LPs
can exit at an unfair price.

**This decision must be made before WP-01 writes the vault**, because it changes
the vault's core storage and interface. It is not a late add-on.

### 2. Arc P4 wants mainnet, and Arc mainnet arrives mid-build

P4 requires being "deployed or deployment-ready on Arc mainnet by **September 30**".
Arc mainnet launches **2026-09-16**. This partially reverses the WP-00 conclusion
that testnet is the only option: testnet is the only option *today*, but mainnet
readiness is a scored deliverable, and the window opens during the build.

**Plan:** build and prove everything on Sepolia ⇄ Arc testnet as decided. Then,
once Arc mainnet is live, check whether CCTP V2 is deployed on it. If it is,
deploying is a change to `packages/domain/src/config/chains.ts` plus a CREATE2
deployment — no code change, because direction and asset are already configuration.
If CCTP is not on Arc mainnet, we are "deployment-ready" and can evidence that
claim with the config diff and the deterministic address prediction.

That readiness argument is only credible because of the WP-00 architecture. Say it
explicitly in the submission.

---

## Deliverables required by every targeted prize

| Deliverable | Produced in | Notes |
| --- | --- | --- |
| Functional MVP, frontend **and** backend | WP-03, WP-11 | Both are named explicitly by Arc. |
| Architecture diagram | WP-12.2 | Arc names it in all five prizes. |
| Demo video, **2–4 minutes** | WP-12.5 | The Graph specifies the length. 720p+, spoken audio. |
| Public repository | Done | Public since WP-00. |
| Detailed documentation / README | WP-12.3 | Arc asks for "detailed documentation". |
| Working demo + source code access | WP-11, WP-12 | Privy asks for both, both prizes. |
| Start Fresh pool selected | Dashboard | The Graph P2 requires it; confirm in the entry. |
| **State which bounties we are submitting for** | WP-12.3, dashboard | Arc repeats this on every prize: *"Please be clear what bounty you are submitting for as a part of your submission!"* Put an explicit bounty-mapping section in the README. |

## Per-prize requirement checklist

### Arc/Circle P2 — Best Agentic Economy Application

- [x] Agents with **clear decision logic tied to real signals** → `AgentDecision.inputsUsed` records live liquidity, exposure, utilisation and settlement latency behind every quote (WP-04, WP-08, WP-14). Verified live.
- [ ] **Autonomous spending and settlement flows using USDC** → the *mechanism* is real and live (solver fast-fills from the vault with no human approval), but the signer is still `LocalAgentSigner`, not the sponsor's wallet — see next row. Partial.
- [ ] **Agent Stack integration** connecting wallets to onchain actions → **not started**. WP-09 is still parked, blocked on the user obtaining a Circle API key.
- [ ] Nanopayments / Paymaster / App Kits where relevant → not evaluated; folded into WP-09.
- [ ] Arc names the core products for this prize as: **Arc, USDC, Agent Stack, App Kits, Circle Wallets, Circle Contracts, Nanopayments, Paymaster**. We hit Arc and USDC live. Agent Stack/Circle Wallets are **not** hit yet — today's wallet layer is Privy's embedded wallet, not a Circle Wallet, and that's a real product-naming gap until WP-09 lands.
- [ ] Architecture diagram, video, docs, repo → repo done; diagram/video/docs not started (WP-12).

### Arc/Circle P4 — Launch on Arc Testnet & Push to Mainnet

- [x] **Crosschain transfers with Arc settlement** → live, real CCTP, verified end-to-end this session (WP-10, WP-14).
- [x] **Settlement logic** → dual fast/canonical settlement with LP reimbursement, including the double-settlement fix, live-verified (WP-06, WP-10).
- [ ] **Deployed or deployment-ready on Arc mainnet by 2026-09-30** → not started. Arc mainnet launches 2026-09-16 (6 days out) — nothing to do until then except keep the config-diff/CREATE2 readiness argument true, which it currently is.
- [ ] Architecture diagram, video, docs, repo → not started (WP-12).

### Arc/Circle P1 — Best DeFi/Onchain Finance Application

- [x] **Meaningful Arc and USDC integration** → real USDC, real Arc execution, verified live (WP-10).
- [x] **Advanced programmable money flows** → conditional advance against a verified commitment, live (WP-05, WP-06).
- [x] Payment/liquidity workflows → LP vault, fee accounting, reimbursement, live and tested (WP-02, WP-06).
- [ ] Arc names the core products for this prize as: **Arc, USDC, App Kits, Circle Wallets, Circle Contracts, CCTP, Gateway, StableFX**. Arc, USDC, CCTP squarely hit. "Circle Wallets" has the same gap noted under P2 — today's wallet is Privy's, not Circle's.

### The Graph P2 — Best AI Tooling or AI Use Case (From Scratch)

- [x] **The Graph is load-bearing** → asserted as a test, not a claim: disabling it halts discovery (WP-08 gate).
- [x] **Live data from a Graph provider** → both subgraphs deployed and queried live at v0.0.2 on Subgraph Studio, wired into the frontend this session (WP-08, this session's frontend wiring).
- [ ] **No mocked or static datasets in the qualifying path** → true today (mocks only in the local E2E harness), but the *qualifying run itself* (WP-11.1, Privy → Graph discovery → Agent Wallet → fast-fill → CCTP settle, one continuous path) has never actually been executed — it can't complete until WP-09 lands. Real risk decisions and real quotes are live; the single unbroken qualifying run is not yet captured.
- [x] **Meaningful work with the data**: reasoning, decisions, automation → the risk engine decides, prices and acts on it, live (WP-04, WP-14).
- [ ] Open-source with clear README → README is substantial but has no LICENSE file yet (MIT/Apache, WP-00.2) and no bounty-mapping section (see deliverables table below).
- [ ] Public repo + 2–4 minute demo video → repo done; video not started.
- [x] **Begun and built during the hackathon** → confirmed against `git log`: first commit 2026-09-04, clean incremental history through today, no prior code.
- [ ] **Start Fresh pool selected** in the dashboard → can't verify from the repo; needs the user to confirm on the ETHGlobal project entry.
- [ ] Optional: **x402 per-query payment** → not built, deferred to V3 per the spec.

### The Graph P1 — Composable/Standardized (optional upgrade)

- [ ] Compose **two or more** Graph products, **or** build meaningfully on a standardized schema. **Still fully open** — no ERC-4626 conversion, no Subgraph MCP work has started.
- [ ] Route A: subgraphs + **Subgraph MCP** for cross-protocol/natural-language access.
- [ ] Route B: **ERC-4626 vault** + a contributed composable **Substreams module** for ERC-4626 vault flows — the example the prize text names.
- [ ] **Make the standards leverage clear**: show what became *easier* because a shared schema or composed product was used.

### Privy P2 — Best Financial Flow

- [x] **Privy is integral** → confirmed live this session — it is the only authentication and wallet layer; the user connected via Privy successfully (WP-03).
- [x] **At least one Privy wallet created or used** → confirmed live: the connected wallet signs `approve`/`createIntent` (WP-03).
- [ ] **A complete functional financial flow** using a generally available feature → the pieces are individually proven live (approve+deposit, createIntent, real quote), but the single continuous demo run (WP-11.1) capturing them as one flow hasn't been executed yet.
- [ ] Working demo + source access → source yes; recorded demo not started.
- [ ] Explain how Privy **improves the user experience** → not yet written into the README (WP-12.3).
- [x] Mocking-rule discipline: *"...must be a real Privy wallet action, not a mock."* → true today — every Privy-gated action this session was a real signed transaction, never mocked.

### Privy P1 — Best B2B Financial Product (scope decision)

- [ ] Business/organizational use case → would need an LP-treasury or operator surface.
- [ ] At least one Privy **control** feature: policies, signers, key quorums, or intents.
- [ ] A functional B2B workflow: payment, approval, treasury operation, or wallet administration.

An LP deposit/withdraw console governed by Privy policies would satisfy this and
reuses WP-02's vault. Judge it as scope creep unless WP-11 lands early.

---

## Open

- [ ] Confirm the **submission deadline** and judging schedule from the dashboard; not on the public pages.
- [ ] Confirm **Start Fresh** is selected on the project entry.
- [ ] Review Circle's [Agent Stack starter kits](https://github.com/circlefin/agent-stack-starter-kits) before WP-09.

---

## Audit — 2026-09-10, post-WP-14

**Bottom line:** the mechanism is real and load-bearing everywhere it's supposed to be (Arc/USDC/CCTP transfers, The Graph discovery and risk data, Privy auth) — verified live, not by reading code. Every gap left is one of three kinds, not a design problem:

1. **WP-09 (Circle Agent Wallet) is the single biggest blocker.** It gates: the Agent Stack line item on both Arc prizes, "Circle Wallets" product coverage on both Arc prizes, and the one-continuous-run acceptance gate for both The Graph P2 and Privy P2 (WP-11.1). Still parked on the user's Circle API key.
2. **Submission-evidence deliverables haven't started at all** — architecture diagram, demo video, bounty-mapping section in the README, LICENSE file. All WP-12, all mechanical once the product work above is settled.
3. **Two dashboard-only confirmations** (Start Fresh pool selection, submission deadline) can't be verified from the repo — need the user to check the ETHGlobal entry directly.

Not a gap, but worth flagging again: **The Graph P1 ($5,000) is still fully unaddressed** — no ERC-4626 conversion, no Subgraph MCP work. It's the single largest prize left on the table and needs an explicit go/no-go decision, not a default.
