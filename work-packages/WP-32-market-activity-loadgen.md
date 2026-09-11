# WP-32 — Automated real testnet market activity (M32)

**Objective:** a configurable intent-load generator that produces a live economy on both chains
with organically emerging scarcity (~20% of operating time with no fast fill available) — never a
scheduled "off" window.

**Depends on:** WP-24 (types) to write; WP-31 to run. **Stack:** new `packages/loadgen`.

## Sub-tasks

- [ ] **32.1 Package.** `pnpm loadgen:start` with `loadgen.config.json` (schema validated, all
      knobs configurable): wallets (per chain, funded by you), direction mix, `phases[]` each with
      `{durationRange, intentsPerMinuteRange, amountDistribution (lognormal params + caps),
      maxFeeBpsDistribution (weighted buckets incl. deliberately-too-low), clusterProbability,
      clusterSize, largeIntentProbability, largeAmountRange}`, phase selection weights, seed for
      reproducibility. Default profile: `background` (low), `burst` (medium, 3–8 min),
      `whale` (single large), `cluster` (4–8 intents in 30 s), `tight-fee` (maxFee below mid tier).
- [ ] **32.2 Bot loop.** Approve once; `createIntent` v2 (USDC-only by default; trade intents
      behind `tradeIntentShare` once WP-34 lands); deadlines 30–90 min; random nonces; persists
      `intentId`/tx per intent to `loadgen.jsonl`.
- [ ] **32.3 Scarcity controller (open loop, no coordination).** Reads the ecosystem intelligence
      endpoint (WP-33) or the Nest directly for `aggregateAvailableLiquidity`; logs the
      constrained/unconstrained fraction over a rolling window; **only tunes phase weights within
      configured bounds** toward the target (default 20%), so scarcity emerges from load vs capital,
      not from switching anything off.
- [ ] **32.4 Metrics export** (`loadgen.metrics.json` rolling): fast-fill rate, canonical-only rate,
      per-vault utilisation, fee at fill, settlement latency, capital turnover, solver participation,
      intent volume/size, outstanding exposure, scarcity periods — the brief's list, computed from
      the Nest, so WP-33 can serve the same numbers.

## Tests

- [ ] Config schema + phase sampler pure-function tests (deterministic under seed); scarcity
      controller stays within bounds; a dry-run mode that emits the intent plan without sending.

## Acceptance gate

Running for ≥ 2 h against WP-31's deployment yields visible tier changes on every vault, at least
one exhaustion → fallback → reimbursement → recovery cycle per vault, and a constrained fraction
in 15–25% without any hard-coded off period.
