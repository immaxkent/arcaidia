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

### 1. The Graph P1 does not qualify as designed — and P2 needs a deliberate framing

P1 explicitly requires composing **two or more** Graph products, or building on a
standardized schema, and states that simply querying one subgraph without
composition does not qualify. Our WP-08 plan — two vanilla subgraphs, one per
chain, merged client-side — is exactly what that rule excludes.

**P2 is the honest fit**: "AI agents or apps that use The Graph as their live
source of blockchain data", with risk monitors and execution agents named as
qualifying. Our solver is a risk monitor that acts. P2 also states that mocked or
static datasets disqualify, which is already our WP-08 gate verbatim.

One tension to manage: P2 is framed as an **AI** track, while our specification
mandates that capital-safety decisions stay deterministic and never LLM-driven.
These are reconcilable and we should not compromise the determinism to chase the
prize — P2's own wording asks for "reasoning, decisions, automation, or a
natural-language interface", and a deterministic autonomous agent doing all three
against live Graph data satisfies it. The LLM narration layer (WP-04.11) and a
natural-language query surface over our own indexed state strengthen the framing
without touching the decision path.

**Optional upgrade to also qualify for P1:** adopt **Subgraph MCP** as a second
Graph product — either consumed by the solver or exposed so other agents can
query Arcaidia's state. That is a genuine composition, fits the agentic story, and
is the cheapest route to a second $5,000 pool. Decide before WP-08 starts;
do not bolt it on afterwards.

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

## Per-prize requirement checklist

### Arc/Circle P2 — Best Agentic Economy Application

- [ ] Agents with **clear decision logic tied to real signals** → `AgentDecision.inputsUsed` records live liquidity, exposure, utilisation and settlement latency behind every quote (WP-04, WP-08).
- [ ] **Autonomous spending and settlement flows using USDC** → solver advances USDC from the vault without human approval (WP-05, WP-09).
- [ ] **Agent Stack integration** connecting wallets to onchain actions → Circle Agent Wallet signs the EIP-712 fill authorization (WP-09).
- [ ] Nanopayments / Paymaster / App Kits where relevant → evaluate in WP-09; not required if the others are strong.
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

### The Graph P2 — Best AI Tooling or AI Use Case (From Scratch)

- [ ] **The Graph is load-bearing** → disabling it halts automated discovery entirely (WP-08 gate).
- [ ] **Live data from a Graph provider** (Subgraph Studio or The Graph Market) → both subgraphs deployed and queried live (WP-08).
- [ ] **No mocked or static datasets in the qualifying path** → mocks exist only in the local E2E harness; state this distinction plainly (WP-07 vs WP-11).
- [ ] **Meaningful work with the data**: reasoning, decisions, automation → the risk engine decides, prices and acts (WP-04).
- [ ] Open-source with clear README → WP-12.3.
- [ ] Public repo + 2–4 minute demo video → WP-12.
- [ ] **Begun and built during the hackathon** → the commit history evidences this; another reason for granular commits.
- [ ] Start Fresh pool selected in the dashboard.

### The Graph P1 — Composable/Standardized (optional upgrade)

- [ ] Compose **two or more** Graph products → subgraphs + **Subgraph MCP** (decision pending).
- [ ] Make the standards leverage clear: show what became easier.

### Privy P2 — Best Financial Flow

- [ ] **Privy is integral** → it is the only authentication and wallet layer (WP-03).
- [ ] **At least one Privy wallet created or used** → the user's wallet signs the intent (WP-03).
- [ ] **A complete functional financial flow** using a generally available feature → bridging / stablecoin transfer, both named as eligible (WP-03, WP-11).
- [ ] Working demo + source access → WP-11, WP-12.
- [ ] Explain how Privy enhances the user experience → WP-12.3.

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
