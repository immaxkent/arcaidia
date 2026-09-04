# WP-11 — Full sponsor E2E (M11)

**Objective:** the qualifying path, end to end, with every sponsor integration live and
load-bearing. One repeatable demo.

**Depends on:** WP-08, WP-09, WP-10. **Blocks:** WP-12.
**Stack:** Privy + The Graph + Circle Agent Stack + CCTP + Arc/Ethereum.

## Sub-tasks

- [ ] **11.1 The qualifying run.** Privy login → user intent → router commits USDC to CCTP →
      The Graph indexes and the solver discovers → independent RPC verification → deterministic
      risk decision with live inputs → Circle Agent Wallet authorises → destination vault fast-fills
      the recipient → CCTP completes → LP reimbursed → UI shows `FAST_FILLED` then `SETTLED`.
- [ ] **11.2 The mirror run.** Identical, chains swapped. Same UI, same solver entry point.
- [ ] **11.3 The fallback run.** Solver disabled → canonical CCTP pays the recipient. Prove funds
      are never trapped.
- [ ] **11.4 Repeatability.** Run the full path at least five times. Fix every flake. Reliability
      here is worth more than any additional feature.
- [ ] **11.5 Timing data.** Record fast-fill latency vs canonical settlement latency across the
      runs. That delta *is* the product; quote it in the video with real numbers.
- [ ] **11.6 Failure rehearsal.** Kill the Graph endpoint mid-demo, kill the settlement worker,
      let an authorization expire. Confirm each degrades safely, and know what you would say on
      camera if it happens live.
- [ ] **11.7 Bounty evidence capture.** For each sponsor requirement, capture a concrete artefact —
      tx hash, GraphQL query + response, decision JSON, wallet policy screenshot. Collect them as
      you go, not on submission night.

## Acceptance gate

One repeatable end-to-end demo proves all V1 sponsor integrations are load-bearing:

- **Arc/Circle** — Arc is a real execution/settlement environment; real USDC in the qualifying
  path; Agent Wallet is the machine authority; substantive decision logic tied to live liquidity,
  exposure, fee and CCTP-health signals; CCTP provides canonical settlement.
- **The Graph** — live data from both chains drives discovery and aggregation; the agent acts on
  Graph-derived state; the Graph is not the LP security oracle.
- **Privy** — the authentication/wallet layer for the actual financial flow; one UI, both directions.

## Traps

- A demo that only works once, from a warm cache, on your machine.
- Discovering on submission night that a sponsor requires an artefact you never captured.
- Running out of testnet USDC or gas mid-demo. Fund generously and check before recording.
