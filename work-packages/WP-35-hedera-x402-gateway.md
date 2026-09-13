# WP-35 — Hedera x402 paid ecosystem intelligence (M35)

**Objective:** an optional, paid gateway around WP-33's intelligence endpoints, paid per
request in HBAR over the x402 protocol on Hedera testnet, with a solver that buys the view it
uses and reports the receipts. The protocol and the baseline solver never depend on it.

**Depends on:** WP-33. **Branch:** `v3-hedera` off `main`. **Stack:** `packages/x402-gateway`
(Express + `@x402/express` + `@x402/hedera`), `@x402/fetch` in the solver.

## Shape (as built, 2026-09-13)

- **Gateway** (`packages/x402-gateway`): proxies `GET /v1/intelligence/*` to the relay. Unpaid
  → `402` with `PAYMENT-REQUIRED` (scheme `exact`, `hedera:testnet`, HBAR asset `0.0.0`, the
  tinybar price, `payTo`, and the facilitator's `feePayer`); paid (`PAYMENT-SIGNATURE`) → the
  facilitator (Blocky402 testnet, `https://api.testnet.blocky402.com`) verifies and settles the
  Hedera transfer, the relay's bytes come back verbatim with the receipt in `PAYMENT-RESPONSE`.
  Free: `/health`, `/v1/pricing` (the same table the paywall enforces). Prices: ecosystem
  0.01 ℏ, chain 0.005 ℏ, vault 0.005 ℏ, quote-context 0.02 ℏ (`src/pricing.ts`).
- **Solver** (`packages/agent`): `createHederaPayingFetch` wraps `fetch` with `@x402/fetch` and
  a Hedera client signer; every settled receipt lands in a `PaymentLedger`. Configured by
  `INTELLIGENCE_URL` + `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY`; without the credentials the
  same provider reads the free relay endpoint. `INTELLIGENCE_MODE=advisory|selective` per D13
  (`src/solver/intelligence-policy.ts`, pure and tested).
- **Telemetry**: the heartbeat carries `intelligence {mode, paid, payments, totalTinybar,
  lastTransaction, payer}`; the relay keeps it per vault; the console shows an INTEL chip and
  `/intelligence` lists every solver's mode, payment count and last Hedera transaction
  (HashScan link).
- **Web**: `/intelligence` — the ecosystem view, the gateway's live price list, a "request
  unpaid" probe that decodes the real 402 challenge, and the paying solvers. `/earn` — a
  "Use paid intelligence" switch that writes the four env lines (key left blank).
- **Ops**: `x402-gateway` service in `docker-compose.ops.yml`, public at
  `https://intel.<host>`; web `VITE_X402_GATEWAY_URL`.
- **Domain**: `IntelligencePaymentReceipt`, optional `IntelligenceProvider.lastPayment()`,
  `DecisionReason.INTELLIGENCE_HOLD`. No vault, router, receiver or market change.

## Sub-tasks

- [x] 35.1 Gateway with 402 challenge + payment verification/settlement via the facilitator.
- [x] 35.2 Solver payment client behind the existing provider port, with receipts.
- [x] 35.3 Frontend: `/intelligence` shows the price list, the live challenge and the receipts;
      console INTEL chip; `/earn` switch.
- [x] 35.4 D13 `selective` mode — bounded hold-back, never a grant.
- [ ] 35.5 Evidence: one solver paying (House, from the ops box), one unpaid, both filling;
      HashScan transaction ids in the decision log and on `/intelligence`.

## Acceptance

- Unit: gateway 402/paid/upstream-failure paths against a fake facilitator; ledger and
  provider receipts; policy (advisory unchanged, selective holds only under both thresholds,
  never touches a REJECT); config (mode needs a URL, Hedera vars together); relay keeps and
  clears the report; Earn env lines.
- Live: `curl -si https://intel.<host>/v1/intelligence/ecosystem` returns 402 with a Hedera
  requirement; the House solver's heartbeat shows `paid: true` with a growing count and a
  HashScan-resolvable transaction.
