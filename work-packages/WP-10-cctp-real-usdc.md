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

- Live testnet run in **both** directions: canonical transfer reimburses the opposite-chain vault.
- Fallback run on live testnet: no fast fill → canonical delivery to the recipient.
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
