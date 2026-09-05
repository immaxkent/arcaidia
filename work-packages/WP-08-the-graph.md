# WP-08 — The Graph integration (M8)

**Objective:** replace `InMemoryObservationProvider` with a live, Graph-backed provider indexing
both chains. The Graph must be visibly load-bearing — and visibly *not* an authorization oracle.

**Depends on:** WP-07 green. **Blocks:** WP-11.
**Stack:** The Graph, GraphQL, TypeScript.

## Sub-tasks

- [x] **8.1 Resolve Q6/Q7** — can the target Arc network be indexed, and by which Graph product?
      Answer this **before** writing mappings; it may change the deployment path entirely.
- [x] **8.2 Subgraph per chain.** Manifest + mappings for `IntentCreated` (with CCTP correlation
      fields), `FastFilled`, `SettlementReceived`, vault deposits/withdrawals.
- [x] **8.3 Entities.** `Intent` (with **separate** fast and canonical status fields),
      `Vault` (liquidity, reserved, utilisation), `Fill`, `Settlement`, `AgentDecision`,
      and aggregates: pending intents, available/reserved liquidity, outstanding unsettled
      exposure, settlement age, historical fills.
- [x] **8.4 `GraphObservationProvider`** implementing the same `ObservationProvider` interface as
      the in-memory one. **The solver code does not change** — that is the proof the adapter
      boundary was drawn correctly.
- [x] **8.5 Cross-chain merge.** Two subgraphs, one consolidated view, keyed by `intentId`.
      Handle each chain's indexing lag independently and expose staleness to the risk engine.
- [x] **8.6 Agent decision records.** Persist, per decision, the exact Graph-derived inputs used
      for the quote (spec §12) — and surface them in the WP-03 decision panel.
- [x] **8.7 Keep RPC verification.** Graph discovery is followed by independent RPC verification
      before LP funds move, unchanged from WP-04.9. Make this explicit in code comments and README:
      it is the answer to "what if your indexer is compromised?"
- [x] **8.8 Graph-down behaviour.** Automated discovery halts; nothing gains authority over funds;
      the settlement agent keeps reconciling from chain. Test it by pointing at a dead endpoint.

## Tests

- Provider parity: `GraphObservationProvider` and `InMemoryObservationProvider` produce equivalent
  decisions for the same underlying state — the strongest evidence the interface held.
- Mapping unit tests (matchstick or fixture-driven) for each handler.
- Kill-the-Graph test: discovery stops, no fills occur, no funds are at risk, recovery on return.
- A demonstrable case where **live Graph state changes the decision** — e.g. a large pending
  exposure visible only through the aggregate causes a REJECT that would otherwise be an ACCEPT.
  This is the gate's evidence; script it for the video.

## Acceptance gate

Disabling The Graph stops automated discovery and processing. Live Graph data **materially changes**
agent decisions. Static or mocked Graph data is not used anywhere in the qualifying path.

## Traps

- Indexing lag read as "no pending exposure" → over-lending. Expose staleness and treat a stale
  feed as a risk signal, not as zero.
- Letting the Graph aggregate become the only source for the exposure cap. Cross-check against
  onchain vault state.
- README that says "we use The Graph" without naming the indexed entities and the decisions they
  influence — the bounty asks for exactly that.
