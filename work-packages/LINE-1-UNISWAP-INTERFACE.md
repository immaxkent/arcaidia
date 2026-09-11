# Line 1 — Uniswap V2 testnet market environment: the interface contract

**For the agent/team building the destination-token market. Self-contained; read this and
`packages/domain/src/config/markets.ts` (shape reserved by WP-24). Branch: `v2-uniswap` off `main`.**

Arcaidia core understands *trade-intent semantics* (`tokenOut`, `targetMinOut` on the canonical
intent — see `V2-MIGRATION-PLAN.md` §D), never Uniswap internals. Everything Uniswap-specific
lives behind one adapter. Core's fast path, CCTP settlement and the vault's USDC fallback do not
depend on anything in this document existing.

## 1. What you deploy (both Ethereum Sepolia `11155111` and Arc Testnet `5042002`)

1. A Uniswap V2-style `Factory` + `Router02` (fork the canonical V2 contracts; Solidity 0.8-compatible
   port is fine). Plain `new` deployments; addresses need not match across chains.
2. Four mock ERC-20s per chain (`MockETH`, `MockAAVE`, `MockARB`, `MockUNI` — names may change;
   18 decimals; permissionless `mint` for testnet), and four pools each paired with the chain's real
   settlement USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` on Sepolia,
   `0x3600000000000000000000000000000000000000` on Arc — both 6 decimals).
3. Seed liquidity at deliberately different prices per chain so they drift.
4. The rebalancing bot: holds inventory on both chains, **never bridges**, observes both pools of
   each pair, swaps locally toward the other chain's price. Configurable interval/thresholds; no
   inventory-neutrality guarantee required.
5. `UniswapV2SwapAdapter` implementing `ISwapAdapter` below — one per chain, pointing at that
   chain's router, with an allowlist of `(tokenIn, tokenOut)` pairs it supports.

## 2. `ISwapAdapter` — frozen (`contracts/src/interfaces/ISwapAdapter.sol`, written by WP-24)

```solidity
interface ISwapAdapter {
    /// Expected output for an exact-input swap right now. Pure quote; no state change.
    function quote(address tokenIn, address tokenOut, uint256 amountIn)
        external view returns (uint256 amountOut);

    /// True iff this adapter supports the pair and `quote(...) >= minOut` right now.
    function canSatisfy(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external view returns (bool);

    /// Pull `amountIn` of `tokenIn` from `msg.sender` (caller approves first), swap, deliver
    /// `tokenOut` to `recipient`. MUST revert if `amountOut < minOut`. MUST NOT hold balances
    /// between calls. Returns what was actually delivered.
    function swapExactInput(
        address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient
    ) external returns (uint256 amountOut);
}
```

Rules the vault relies on (WP-26 wraps the call in `try/catch` and falls back to delivering USDC):
- Reentrancy-safe: the vault is `nonReentrant`; do not call back into `msg.sender`.
- Deadline: use `block.timestamp` internally; the vault passes none.
- No fee-on-transfer assumptions on USDC; mock tokens must be plain ERC-20s.
- `swapExactInput` is the *only* state-changing entry point the vault will call.

## 3. TypeScript port (`packages/domain/src/ports.ts`, written by WP-24)

```ts
export interface SwapAdapter {
  quote(chainId: number, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint>;
  canSatisfy(chainId: number, tokenIn: Address, tokenOut: Address, amountIn: bigint, minOut: bigint): Promise<boolean>;
}
```
The solver only ever *reads* (fill/ignore decision); execution happens inside the vault via the
Solidity adapter. Provide `ViemUniswapV2SwapAdapter` implementing this, reading the same pools.

## 4. Config you commit (`packages/domain/src/config/markets.ts`, shape reserved by WP-24)

```ts
export interface DestinationMarket {
  readonly chainId: number;
  readonly tokenOut: TokenConfig;          // { address, symbol, decimals }
  readonly pool: Address;                  // the USDC/tokenOut pair
  readonly kind: 'uniswap-v2';
}
export interface SwapInfrastructure {
  readonly chainId: number;
  readonly factory: Address;
  readonly router: Address;
  readonly swapAdapter: Address;           // the ISwapAdapter the vault owner will set
  readonly markets: readonly DestinationMarket[];
}
export const SWAP_INFRASTRUCTURE: Readonly<Record<ChainKey, SwapInfrastructure | null>>;
```
Fill in real addresses only; leave `null` until deployed. Frontend/solver read this file and
nothing else to learn which `tokenOut`s exist.

## 5. Tests you owe

- Foundry: adapter `quote`/`canSatisfy`/`swapExactInput` against a locally deployed V2 pair,
  including `minOut` revert, unsupported pair revert, and a fuzz that delivered `amountOut ==` returned value.
- A `MockSwapAdapter` is written by WP-26 for core tests — do not depend on it, do not modify it.
- Bot: unit test of the "which side to swap, how much" decision as a pure function.

## 6. Merge protocol

- Do not modify: `ArcaidiaTypes.sol`, `IntentLib.sol`, the router, the vault, the market, the
  receiver, `packages/agent/src/risk/*`, the subgraph schema, the Nest views.
- Your PR into `main` adds contracts under `contracts/src/swap/`, tests, `markets.ts` values,
  `packages/agent/src/adapters/viem-uniswap-v2-swap-adapter.ts`, a bot under `packages/marketbot`,
  and an ABI entry in `scripts/generate-abis.mjs` for the adapter only.
- WP-34 (core) then: vault owners call `setSwapAdapter(adapter)` — no redeploy — the solver's
  `SwapAdapter` port is wired, `VITE_TRADE_INTENTS_ENABLED=true`.
