# WP-34 — Merge Line 1: destination-token execution via the adapter seam (M34)

**Objective:** with the Line 1 market live on both testnets, turn trade intents on end to end
without a contract redeploy: the solver gates them, the vaults deliver them through the
Uniswap adapter, the Trade page creates them, the generator exercises both endings.

**Depends on:** WP-31 live; Line 1 delivered (`immaxkent/uniswap-v2`: adapters, routers, four
pools per chain, the market bot, the price API). **Branch:** `v4-uniswap` off `main`.

## Sub-tasks

- [x] **34.0** Merge the Line 1 payload: `UniswapV2SwapAdapter` + interfaces under
      `contracts/src/swap`, its 25-test suite with the V2 fork vendored test-only,
      `ViemUniswapV2SwapAdapter` behind the `SwapAdapter` port, `SWAP_INFRASTRUCTURE` filled from
      the deployment artifacts, the adapter ABI generated. `ISwapAdapter` unchanged (parity checked).
- [x] **34.1** Solver: `SWAP_ADAPTER_MODE=uniswap-v2` wires one adapter over both chains'
      deployed contracts; `canSatisfy` is asked about the **post-fee** amount (the vault swaps
      `outputAmount`), pinned by a test — the gross-amount gate was optimistic by the fee.
- [x] **34.2** Each vault owner: `setSwapAdapter(<chain's adapter>)` — done 2026-09-13 on all
      six vaults (House ×2 via `script/SetSwapAdapter.s.sol` with the deployer keystore, B and C
      ×2 from the console's owner button with the Privy wallet). Earn wires new vaults automatically.
- [x] **34.3** Frontend: `/trade` — token picker with live price and 24h change, candlestick
      chart of the destination chain with the origin chain's price and trend overlaid and the
      live spread, slippage control; `targetMinOut` = the destination adapter's on-chain quote
      for the solver's output USDC less slippage; history rows show `Swapped → mETH` or
      `USDC fallback` from the Nest's `delivered_via`. Gates independently on the flag +
      market (form) and the price API (chart).
- [x] **34.4** Loadgen: `tradeIntentShare` 0.22 (about two in nine), trades sized 1–8 USDC for
      40 USDC pools, floors quoted by the adapter at submit time, one in five deliberately
      unsatisfiable. `ONCE_TOKEN_OUT=mETH` on the once probe.
- [x] **34.5** Ops: the market's price API (`prices.<host>`, 15 s sampling) and the market bot
      run on the box from the `arcaidia-market` image built from the sibling checkout
      (`scripts/ops-deploy.sh BUILD=local`); solvers run in `uniswap-v2` mode.
- [x] **34.6** Live proof both directions, 2026-09-13, four 2 USDC intents for mETH sent by the
      box's load generator (`ONCE_TOKEN_OUT=mETH`), recipient `0xd2A1…937C`:
      - Ethereum → Arc, satisfiable: intent `0xffc1f4bc…4f23` (create `0xe4ec673c…1099`) —
        fast-filled by Vault B on Arc, `delivered_via: SWAP`, 0.000589694 mETH delivered
        (fill `0x6eb7ccee…e2e6`); the recipient's mETH balance on Arc reads exactly that.
      - Arc → Ethereum, satisfiable: intent `0xd61d5b87…9bf1` (create `0x06357f48…f6da`) —
        fast-filled by Vault C on Sepolia, `delivered_via: SWAP`, 0.000607343 mETH delivered
        (fill `0x62613119…7a2d`); balance on Sepolia reads exactly that.
      - Both directions, floor 50% above market: intents `0x286274e5…9a56` and
        `0x63ffe164…f015` — no vault filled (the post-fee gate declines them,
        `TRADE_NOT_SUPPORTED`); canonical settlement delivers USDC to the recipient.
        `SwapFellBack` is now the rare path (the price moving between gate and execution),
        which is what the gate fix was for.

## Acceptance gate

Recipient receives `tokenOut` on a satisfiable trade intent and USDC otherwise; no core contract
changed since WP-31; the intent schema is unchanged since WP-24.

## Live addresses (Line 1, 2026-09-13)

| | Ethereum Sepolia | Arc Testnet |
| --- | --- | --- |
| swapAdapter | `0xF8a854866226d2Df7e185f9f98a8C1C73422809F` | `0xFD3a3fC4B370C8782D1B7F4FD254492E8d32B779` |
| router | `0xb78911b8438725B3B834e12Fe9D4e716c8D38c72` | `0x000b77298C9AB86eaB86801Fd0caA29a38709D1b` |
| markets | mETH, mAAVE, mGRT, mPEPE (`packages/domain/src/config/markets.ts`) | same |
