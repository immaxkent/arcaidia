# WP-32 — Automated real testnet market activity (M32)

**Objective:** a configurable intent-load generator that produces a live economy on both chains
with organically emerging scarcity (~20% of operating time with no fast fill available) — never a
scheduled "off" window.

**Depends on:** WP-24 (types) to write; WP-31 to run. **Stack:** new `packages/loadgen`.

## Sub-tasks

- [x] **32.1 Package** (`packages/loadgen`, `loadgen.config.json`, `pnpm loadgen:start`, `LOADGEN_DRY_RUN`). `pnpm loadgen:start` with `loadgen.config.json` (schema validated, all
      knobs configurable): wallets (per chain, funded by you), direction mix, `phases[]` each with
      `{durationRange, intentsPerMinuteRange, amountDistribution (lognormal params + caps),
      maxFeeBpsDistribution (weighted buckets incl. deliberately-too-low), clusterProbability,
      clusterSize, largeIntentProbability, largeAmountRange}`, phase selection weights, seed for
      reproducibility. Default profile: `background` (low), `burst` (medium, 3–8 min),
      `whale` (single large), `cluster` (4–8 intents in 30 s), `tight-fee` (maxFee below mid tier).
- [x] **32.2 Bot loop** (`ViemIntentSubmitter`: approve once, `createIntent` v1.1, intent id from the receipt; `loadgen.jsonl`). Approve once; `createIntent` v2 (USDC-only by default; trade intents
      behind `tradeIntentShare` once WP-34 lands); deadlines 30–90 min; random nonces; persists
      `intentId`/tx per intent to `loadgen.jsonl`.
- [x] **32.3 Scarcity controller (reads the Nest `vaults`/`protocol_state` views directly; WP-33's endpoint can replace that source without changing the loop) (open loop, no coordination).** Reads the ecosystem intelligence
      endpoint (WP-33) or the Nest directly for `aggregateAvailableLiquidity`; logs the
      constrained/unconstrained fraction over a rolling window; **only tunes phase weights within
      configured bounds** toward the target (default 20%), so scarcity emerges from load vs capital,
      not from switching anything off.
- [x] **32.4 Metrics export** (`loadgen.metrics.json`; per-vault utilisation/fee, fast-fill and canonical-only rates from the Nest, sizes/volume/phase mix from the journal; latency/turnover land with WP-33) (`loadgen.metrics.json` rolling): fast-fill rate, canonical-only rate,
      per-vault utilisation, fee at fill, settlement latency, capital turnover, solver participation,
      intent volume/size, outstanding exposure, scarcity periods — the brief's list, computed from
      the Nest, so WP-33 can serve the same numbers.

## Tests

- [x] Config schema + phase sampler pure-function tests (22 tests: determinism, caps, burst vs background rate, whale/cluster/tight-fee shapes, direction share, contiguous schedule, controller bounds, dry run, wallet round-robin, failure tolerance) (deterministic under seed); scarcity
      controller stays within bounds; a dry-run mode that emits the intent plan without sending.

## Acceptance gate — pending the live run (needs funded user-bot wallets + an indexer that sees v2)

Running for ≥ 2 h against WP-31's deployment yields visible tier changes on every vault, at least
one exhaustion → fallback → reimbursement → recovery cycle per vault, and a constrained fraction
in 15–25% without any hard-coded off period.
