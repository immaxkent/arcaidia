# WP-34 — Merge Line 1: destination-token execution via the adapter seam (M34)

**Objective:** with `v2-uniswap` merged into `main`, turn on trade intents end to end without a
contract redeploy.

**Depends on:** WP-31 live, Line 1 merged (`UniswapV2SwapAdapter` deployed both chains,
`markets.ts` filled). **Stack:** owner calls, solver config, frontend flag.

## Sub-tasks

- [ ] **34.1** Each vault owner: `setSwapAdapter(<chain's adapter>)` (House + B + C).
- [ ] **34.2** Solvers: `SWAP_ADAPTER_MODE=uniswap-v2` → `ViemUniswapV2SwapAdapter` wired as the
      `SwapAdapter` port; `canSatisfy` now gates trade intents for real.
- [ ] **34.3** Frontend: `VITE_TRADE_INTENTS_ENABLED=true`; markets from `SWAP_INFRASTRUCTURE`.
- [ ] **34.4** Loadgen: `tradeIntentShare > 0` with `targetMinOut` sampled around the live quote
      (some deliberately unsatisfiable → fallback USDC).
- [ ] **34.5** Live proof both directions: trade intent → `DeliveredViaSwap` (recipient holds
      MockETH); unsatisfiable → `SwapFellBack`/canonical USDC.

## Acceptance gate

Recipient receives `tokenOut` on a satisfiable trade intent and USDC otherwise; no core contract
changed since WP-31; the intent schema is unchanged since WP-24.
