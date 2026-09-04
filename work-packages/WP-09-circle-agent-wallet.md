# WP-09 — Circle Agent Wallet (M9)

**Objective:** the agent's bounded machine identity. Replace `LocalAgentSigner` with a real Circle
Agent Wallet, without touching core agent logic.

**Depends on:** WP-07 (WP-08 preferably green too). **Blocks:** WP-11.
**Stack:** Circle Agent Stack / Agent Wallet SDK, TypeScript.

## Sub-tasks

- [ ] **9.1 Resolve Q4 against current Circle documentation** — read the real docs, do not code
      from assumption. Critical question: can the wallet return a **raw EIP-712 signature**, or
      does it only *execute* transactions? If the latter, the wallet calls `fastFill` directly and
      the vault authorises `msg.sender` from the allowlist rather than a recovered signer. Both
      designs are viable; pick one and record the decision in the README.
- [ ] **9.2 Provision the wallet**, capture its address, add it to the vault's `authorisedSigners`
      (or authorised callers) on **both** chains.
- [ ] **9.3 `CircleAgentWalletSigner`** implementing the WP-05 `AgentSigner` interface. Zero changes
      to `processIntent`. If a change is needed, the interface was wrong — fix the interface, not
      the call sites.
- [ ] **9.4 Wallet policies** (Q5): contract allowlist, asset allowlist, per-transaction cap,
      daily cap. Document them as the **second, independent control layer** alongside the vault's
      onchain caps. The security story is two layers, and judges will ask.
- [ ] **9.5 Operational hardening.** API failure, rate limits, timeouts, key rotation. A signing
      failure must never leave a half-executed fill or a consumed intent with no payment.
- [ ] **9.6 Evidence for the demo.** A transaction on the destination chain whose authority is
      demonstrably the Agent Wallet, with the policy configuration shown alongside it.

## Tests

- Signer parity: `CircleAgentWalletSigner` and `LocalAgentSigner` produce authorizations the same
  vault accepts (deterministic tests keep using the local signer).
- Policy enforcement: a transaction exceeding the wallet's per-tx cap is refused **by the wallet**,
  independently of the vault's own cap. Demonstrate both layers rejecting.
- Signing-failure path leaves no inconsistent state.

## Acceptance gate

An actual Agent Wallet authority signs/executes a bounded destination-chain fill, in both
directions, **without changing core agent logic**.

## Traps

- Discovering the sign-vs-execute distinction here rather than in WP-05. Answer Q4 early.
- Letting Circle SDK types leak into the risk engine. The adapter boundary is the whole point.
- Keeping only wallet policy or only vault caps. The claim is two independent layers — build both.
