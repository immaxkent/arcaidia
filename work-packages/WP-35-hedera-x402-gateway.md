# WP-35 — Hedera x402 paid ecosystem intelligence (V3 outline) (M35)

**Objective (outline only — built later under the separate Hedera/x402 instructions):** an
optional, paid gateway around WP-33's intelligence endpoints. The protocol and the baseline
solver never depend on it.

**Depends on:** WP-33. **Branch:** `v3-hedera` off `main`. **Stack:** new `packages/x402-gateway`.

## Shape (frozen here so WP-33 needs no rework)

- Gateway proxies `/v1/intelligence/*`; unpaid request → `402` with the x402 payment-required
  header (Hedera payment details); paid request → upstream response verbatim + receipt.
- Solver: `HttpIntelligenceProvider` gains an `X402PaymentClient` (Hedera signer) — still optional;
  `INTELLIGENCE_URL` unset = baseline solver, unchanged.
- No vault, router, receiver or market change. Nothing in `packages/domain` beyond the client type.
- Evidence for the demo: one solver running with the paid provider, one without, both filling.

## Sub-tasks (to be expanded from the Hedera instructions)

- [ ] 35.1 Gateway with 402 challenge + payment verification against Hedera.
- [ ] 35.2 Solver payment client behind the existing provider port.
- [ ] 35.3 Frontend: "premium intelligence" panel shows the paid response and the receipt.
