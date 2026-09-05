# WP-10 — Real CCTP & USDC configuration (M10)

**Objective:** canonical settlement becomes real. `MockSettlementAdapter` → `CircleCCTPAdapter`,
`settlementAsset` → real USDC. MockUSDC survives for deterministic tests.

**Depends on:** WP-09. **Blocks:** WP-11.
**Stack:** Circle CCTP, viem, deployment config.

## Sub-tasks

- [ ] **10.1 Resolve Q2/Q3** from current Circle documentation: CCTP version on each target chain,
      domain IDs, `TokenMessenger`/`MessageTransmitter` addresses, USDC addresses, faucet path.
- [ ] **10.2 Router CCTP initiation.** Wire the real `depositForBurn` (or the v2 equivalent) behind
      the WP-01.3 `ISettlementInitiator` seam. Capture the message hash / nonce into `cctpRef`
      in `IntentCreated` — the agent and subgraph depend on that correlation key.
- [ ] **10.3 `CircleCCTPAdapter`** implementing the WP-06 `SettlementAdapter` interface: attestation
      polling with backoff, message retrieval, destination `receiveMessage`, health signalling.
- [ ] **10.3a It must SENSE delivery, not assume it.** The local mock proves the *ordering* — funds
      delivered before receipt is recorded — but a real transport has to establish that the funds
      actually arrived. A submitted transaction is not a delivered message. Required:
      - wait for the receipt and check `status === 'success'`;
      - confirm the `MessageReceived` event was emitted by the configured `MessageTransmitter`,
        rather than trusting that the transaction did not revert;
      - treat an **already-consumed nonce as success, not failure** — anyone may submit
        `receiveMessage` on a live network, and an adapter that reads a consumed nonce as an error
        strands settlements that have in fact completed;
      - only then move the message to `RECEIVED`. A failed or ambiguous delivery must leave it
        `ATTESTED` and retryable.
- [ ] **10.3b It must pass the shared conformance suite**, both happy and sad paths, against a real
      network. `packages/settlement/test/conformance/settlement-adapter-conformance.ts` is the
      contract every transport satisfies; the mock passes it today. Point it at `CircleCCTPAdapter`
      with a live harness rather than writing a fresh set of tests, so the real transport cannot
      quietly diverge from what the settlement worker was built against.
- [ ] **10.4 Real-USDC configuration.** Change `settlementAsset` in config only. **If any code
      changes, WP-00.4 was built wrong** — fix the config layer rather than branching the code.
- [ ] **10.5 Attestation timing as a first-class signal.** Feed real observed latency into the risk
      engine's settlement state. Real CCTP latency is the honest input WP-04.6 was designed for.
- [ ] **10.6 Deploy to target networks** via CREATE2; assert identical addresses across Ethereum
      and Arc; record every address in the README.
- [ ] **10.7 Fund LP vaults** with real testnet USDC on both chains.
- [ ] **10.8 Reconciliation under real conditions.** Attestation delay, an out-of-order receive,
      a duplicate receive attempt, a worker restart mid-attestation.

## Tests

- **The conformance suite, green against the live adapter.** Both paths, not just the happy one.
- Live testnet run in **both** directions: canonical transfer reimburses the opposite-chain vault.
- Fallback run on live testnet: no fast fill → canonical delivery to the recipient.
- **Sad paths, exercised against the real network rather than reasoned about:**
  - an attestation requested before it is ready;
  - a `receiveMessage` submitted twice, asserting the second neither reverts the worker nor
    double-delivers;
  - a message delivered by another party first, asserting we treat it as complete;
  - Iris unreachable, asserting the risk engine pauses and the worker keeps its backlog.
- Adapter parity against the mock for status transitions and idempotency.
- Config-only asset switch: the same test suite passes against MockUSDC locally and real USDC on
  testnet, with no source change.

## Acceptance gate

A real canonical transfer reimburses the opposite-chain LP vault. Both directions validated on the
target networks.

## Traps

- Attestation latency treated as an error rather than an economic signal — the spec is explicit
  that delay is an exposure condition, and this is a core part of the pitch.
- Non-idempotent `receiveMessage` submission producing a duplicate or a revert storm.
- Deploying with real-USDC constructor values and breaking CREATE2 address parity. Chain-specific
  values go in `initialize`.
