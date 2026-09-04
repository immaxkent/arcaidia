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

- [ ] Agents with **clear decision logic tied to real signals** → `AgentDecision.inputsUsed` records live liquidity, exposure, utilisation and settlement latency behind every quote (WP-04, WP-08).
- [ ] **Autonomous spending and settlement flows using USDC** → solver advances USDC from the vault without human approval (WP-05, WP-09).
- [ ] **Agent Stack integration** connecting wallets to onchain actions → Circle Agent Wallet signs the EIP-712 fill authorization (WP-09).
- [ ] Nanopayments / Paymaster / App Kits where relevant → evaluate in WP-09; "where relevant", so not required if the others are strong.
- [ ] Arc names the core products for this prize as: **Arc, USDC, Agent Stack, App Kits, Circle Wallets, Circle Contracts, Nanopayments, Paymaster**. We hit Arc, USDC, Agent Stack and Circle Wallets; Circle Contracts is worth a look in WP-09.
- [ ] Architecture diagram, video, docs, repo → WP-12.

### Arc/Circle P4 — Launch on Arc Testnet & Push to Mainnet

- [ ] **Crosschain transfers with Arc settlement** → the entire product (WP-10, WP-11).
- [ ] **Settlement logic** → dual fast/canonical settlement with LP reimbursement (WP-06, WP-10).
- [ ] **Deployed or deployment-ready on Arc mainnet by 2026-09-30** → see gap 2 above (WP-10, WP-12).
- [ ] Architecture diagram, video, docs, repo → WP-12.

### Arc/Circle P1 — Best DeFi/Onchain Finance Application

- [ ] **Meaningful Arc and USDC integration** → real USDC, real Arc execution, not a logo (WP-10).
- [ ] **Advanced programmable money flows** → conditional advance against verified commitment; onchain automation (WP-05, WP-06).
- [ ] Payment/liquidity workflows → LP vault, fee accounting, reimbursement (WP-02, WP-06).
- [ ] Arc names the core products for this prize as: **Arc, USDC, App Kits, Circle Wallets, Circle Contracts, CCTP, Gateway, StableFX**. We hit Arc, USDC, Circle Wallets and CCTP squarely.

### The Graph P2 — Best AI Tooling or AI Use Case (From Scratch)

- [ ] **The Graph is load-bearing** → disabling it halts automated discovery entirely (WP-08 gate).
- [ ] **Live data from a Graph provider** (Subgraph Studio or The Graph Market) → both subgraphs deployed and queried live (WP-08).
- [ ] **No mocked or static datasets in the qualifying path** → mocks exist only in the local E2E harness; state this distinction plainly (WP-07 vs WP-11).
- [ ] **Meaningful work with the data**: reasoning, decisions, automation → the risk engine decides, prices and acts (WP-04).
- [ ] Open-source with clear README → WP-12.3.
- [ ] Public repo + 2–4 minute demo video → WP-12.
- [ ] **Begun and built during the hackathon** → commit history evidences this. Note the exact wording: *"Open-source starter kits are fine; project-specific prior code is not."* We are clean.
- [ ] **Start Fresh pool selected** in the dashboard — the track is judged in two pools and this determines which we compete in.
- [ ] Optional: **x402 per-query payment** — P2 offers *"let your agent pay per query autonomously with x402"*. This is the same x402 surface the specification defers to V3; if it appears cheaply here it is worth more than as a V3 stretch.

### The Graph P1 — Composable/Standardized (optional upgrade)

- [ ] Compose **two or more** Graph products, **or** build meaningfully on a standardized schema.
- [ ] Route A: subgraphs + **Subgraph MCP** for cross-protocol/natural-language access.
- [ ] Route B: **ERC-4626 vault** + a contributed composable **Substreams module** for ERC-4626 vault flows — the example the prize text names.
- [ ] **Make the standards leverage clear**: show what became *easier* because a shared schema or composed product was used. This is the stated judging emphasis, so it needs a specific before/after claim, not a mention.

### Privy P2 — Best Financial Flow

- [ ] **Privy is integral** → it is the only authentication and wallet layer (WP-03).
- [ ] **At least one Privy wallet created or used** → the user's wallet signs the intent (WP-03).
- [ ] **A complete functional financial flow** using a generally available feature → bridging / stablecoin transfer, both named as eligible (WP-03, WP-11).
- [ ] Working demo + source access → WP-11, WP-12.
- [ ] Explain how Privy **improves the user experience** → WP-12.3. The stated bar is hiding unnecessary onchain complexity, which is our whole thesis: the user expresses an outcome and never touches a bridge.
- [ ] Note the mocking rule: *"Features requiring commercial or guided onboarding may be mocked, but they do not count as the required functional Privy integration."* Our live flow must be a real Privy wallet action, not a mock.

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
