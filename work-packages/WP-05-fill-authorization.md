# WP-05 — Fill authorization path (M5)

**Objective:** close the loop from decision to money moving — EIP-712 signature offchain, verified
onchain — with a local signer, in both directions.

**Depends on:** WP-02, WP-04. **Blocks:** WP-06.
**Stack:** TypeScript, viem, Foundry.

## Sub-tasks

- [ ] **5.1 `AgentSigner` interface.** `signFillAuthorization(auth): Promise<Hex>` plus `address`.
      Two implementations planned: `LocalAgentSigner` (this WP) and `CircleAgentWalletSigner`
      (WP-09). **Design the interface against Q4's answer now** — if the Circle wallet can only
      *execute* rather than *sign*, the interface needs an `execute` shape too, and finding that
      out in WP-09 is a rewrite.
- [ ] **5.2 `LocalAgentSigner`** using a viem local account and the shared EIP-712 schema from
      `packages/domain`.
- [ ] **5.3 Vault signature verification.** `ArcaidiaLiquidityVault.fastFill` recovers the signer,
      checks the allowlist, checks `intentId` unused, agent `nonce` unused, `expiry` not passed,
      amounts within caps, fee within limits, liquidity sufficient, not paused; marks consumed;
      transfers. Short expiry (30–60s) per spec.
- [ ] **5.4 Domain separator binding.** The EIP-712 domain must bind `chainId` and the verifying
      vault address, so an authorization for one chain's vault cannot be replayed on the other.
      **Test this explicitly** — it is the sharpest edge in a symmetric bidirectional deployment.
- [ ] **5.5 Solver orchestration skeleton.** `processIntent(intent)`: observe → verify (WP-4.9) →
      evaluate (WP-4) → sign → submit fast fill → record. One code path, direction from config.
- [ ] **5.6 Submission robustness.** Idempotent submit, nonce management, gas estimation,
      revert-reason decoding into the typed errors from WP-00.

## Tests

Foundry: valid signature fills; tampered `recipient`/`outputAmount`/`intentId` each revert;
signature from a non-allowlisted key reverts; expired authorization reverts; replayed `intentId`
reverts; replayed agent nonce reverts; an authorization built for chain A's vault reverts on
chain B's vault.
Vitest + local chains: full `processIntent` produces a confirmed fast fill, ETH→Arc and Arc→ETH.

## Acceptance gate

Complete local fast-fill works in both directions; every tamper and replay test fails safely.

## Traps

- A domain separator that omits the vault address or chain ID — cross-chain replay in a protocol
  whose entire premise is symmetric deployment.
- Signing before verification. Verify the source receipt first, always.
- An `AgentSigner` interface shaped only around local signing, then discovering in WP-09 that the
  Circle wallet has a different execution model.
