# WP-03 — Frontend (M3)

**Objective:** the real product, wired to the real backend. Not a thin proof-of-concept anymore —
by the time this work package lands, WP-00–08 have already produced a tested solver, vault,
settlement worker and subgraph, and this is the only surface a judge will actually click.

**Depends on:** WP-01 (ABIs + addresses), WP-04 (risk engine), WP-06 (settlement worker),
WP-08 (observation). **Unblocks:** every Arc prize (all require a working frontend) and both
Privy prizes, which currently have zero coverage.

**Stack:** Next.js 15, React, TypeScript, Privy, viem, Tailwind, `@react-three/fiber`.
**Design source:** `docs/frontend-spec.md` — the full visual and interaction spec, handed to
Lovable for generation. This work package is the **wiring**: connecting whatever Lovable
produces to the real backend data described in that spec's §7.

## Resolved before this work package started

**Q8 (Privy + Arc), fully answered** — see `OPEN-QUESTIONS.md`. Embedded wallets chosen.
Privy supports arbitrary EVM chains via `defineChain`; Arc's USDC-as-gas-token is not an
obstacle because it is native at the protocol level, not a gas abstraction. Default fee
estimation (`baseFeePerGas`, `feeHistory`, `maxPriorityFeePerGas`) verified live against Arc
testnet and confirmed to work untouched — this is asserted by `pnpm test:chains`, re-runnable
whenever Arc's tooling might have changed underneath us. One operational note carried into the
demo script, not the code: gas on Arc is USDC, so a fresh embedded wallet must be pre-funded
from `faucet.circle.com` before it can send anything.

## Sub-tasks

- [ ] **3.1 Wire Lovable's output into `apps/web`** inside the existing monorepo, importing
      types and config from `packages/domain` and `packages/agent`. Delete `lib/mock-data.ts`
      (per the spec's definition of done) once every route reads real data.
- [ ] **3.2 Privy auth + wallet.** Embedded wallets, both chains in `supportedChains` via
      `defineChain` (§8 of the spec has the Arc chain definition). Test both directions send
      without the "chain not in supportedChains" throw.
- [ ] **3.3 `/transfer`.** Direction toggle (one component pair, never two routes), intent form,
      approve + submit, and the **two-track settlement timeline** — fast and canonical rendered
      as genuinely independent tracks, never a single progress bar. This is the same hard
      requirement WP-00 stated for the domain types; the UI must not undo it.
- [ ] **3.4 `/solver`.** Live decision feed, reading `AgentDecision` records as they are produced.
      Each row expandable to the full `DecisionInputs` readout. This is the demo's money shot —
      the visible evidence of an autonomous agent pricing risk from live state.
- [ ] **3.5 `/liquidity`.** Vault selector, deposit/withdraw, the liquid/advanced/fees composition
      bar. Reads `VaultState` — LP assets computed as
      `totalBalance + outstandingExposure − accruedProtocolFees`, never including the treasury's
      share, matching the vault's own accounting exactly.
- [ ] **3.6 `/about`.** The ten-stage paginated walkthrough, copy already written in the spec §6.
- [ ] **3.7 `/docs`.** Static: architecture, the trust assumption stated plainly, addresses, fees, FAQ.
- [ ] **3.8 The 3D background** (spec §3), with its performance guardrails honoured: capped DPR,
      paused when hidden, reduced-motion fallback to one static frame.
- [ ] **3.9 LLM narrative layer.** `AgentDecision.narrative` — an optional field that exists
      today and that nothing currently writes — populated by an LLM call **strictly downstream
      of the verdict**, explaining a decision already made in plain language for the `/solver`
      feed. Example: *"Declined. The Arc vault is 78% utilised and CCTP has been running four
      minutes behind for the last hour, so the risk-priced fee came to 45bps — above the 30bps
      ceiling this user set."* A test must assert that removing the narrative call changes no
      verdict, no fee, no amount — the same guarantee WP-04 already gives the deterministic core,
      extended to prove the narration cannot leak into it.
- [ ] **3.10 x402-gated risk endpoint.** `GET /risk/:intentId`, gated by HTTP 402, returning the
      same `DecisionInputs` readout the MCP server (WP-12.8) already exposes for free to an MCP
      client — sold instead of given away, to an external caller paying in USDC. No new decision
      logic: this is the existing read-only surface behind a payment gate, not a second solver.
      Answers Circle's Nanopayments mention and The Graph P2's x402 mention directly.

## Tests

- Component tests: the direction toggle produces mirrored, valid intent payloads for both routes.
- The status view cannot render a single "complete" state from fast status alone — assert this
  explicitly, the same guard `packages/domain`'s vocabulary test already enforces on the types.
- LP asset display never includes `accruedProtocolFees` — a component test against a `VaultState`
  fixture with non-zero fees.
- Narrative layer: removing/nulling the narrative call leaves `verdict`, `feeAmount`,
  `outputAmount` byte-identical — same property WP-04's own tests already assert on the core.
- x402 endpoint: a request without payment gets 402; a request with valid payment gets exactly
  the same shape `ArcaidiaTools.vaultState`/`settlementHealth` already return.
- A manual scripted run: Privy login → intent created on chain A → visible on chain A explorer →
  timeline shows fast-filled while canonical is still pending → both tracks eventually settle.
  Repeated with the chains swapped.

## Acceptance gate

A real Privy wallet creates an intent in either direction through the deployed UI, the resulting
transaction is visible onchain, the settlement timeline never collapses the two states, the
solver activity feed shows live decisions with their full inputs, and the liquidity page's
figures reconcile with the vault contract's own accounting.

## Traps

- Collapsing `FAST_FILLED` and `SETTLED` into "Done" anywhere — the timeline, a toast, a summary
  card. Explicitly forbidden by the spec and a near-certain judge question.
- Two route trees (`/eth-to-arc`, `/arc-to-eth`). Same components, direction as state.
- Letting the narrative call anywhere near `evaluateIntent`'s inputs or outputs — it must read
  a finished `AgentDecision` and write only to `narrative`, nothing else.
- Treating the x402 endpoint as a second pricing engine. It has no verdict logic of its own; it
  serves the same numbers `ArcaidiaTools` already computes from the same `ObservationProvider`.
- Losing §7 of `docs/frontend-spec.md` in translation from Lovable's output — if the generated
  components invented their own shapes instead of the real `Intent`/`AgentDecision`/`VaultState`
  types, this work package is adaptation, not wiring, and will take materially longer.
