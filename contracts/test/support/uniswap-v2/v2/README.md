# The V2 port

A fork of canonical Uniswap V2 (core `0.5.16`, periphery `0.6.6`) compiled as a single
`0.8.28` unit, so the whole market environment and the adapter that Arcaidia merges build
under one compiler with Arcaidia's exact settings.

Every delta from the canonical source is listed here. There are no others.

## Mechanical, behaviour-preserving

| Change | Why |
| --- | --- |
| `SafeMath` removed | `+ - *` are checked in 0.8 and revert exactly where `.add/.sub/.mul` did |
| `uint(-1)` to `type(uint256).max`, `uint112(-1)` to `type(uint112).max` | 0.8 syntax |
| `block.chainid` instead of inline assembly in the LP token's domain separator | 0.8 exposes it directly |
| `new Pair{salt:}()` instead of inline `create2` | same opcode, same salt, same address |

## Deliberate, and load-bearing

**`unchecked` in `UniswapV2Pair._update`.** Canonical V2 *relies* on wrapping in two
places: the `uint32` timestamp difference, and the `uint256` price accumulators. Both are
commented as intentional overflow in the original. Under 0.8 they would revert once a
pool had been idle across a `uint32` boundary, or once the accumulators wrapped, so they
are wrapped in `unchecked` to preserve the original behaviour. Nothing else is unchecked.

**`UniswapV2Library.pairFor` asks the factory.** Canonical `pairFor` derives the pair
address from a hardcoded `INIT_CODE_PAIR_HASH`. That constant is a hash of the pair's
compiled bytecode, so it is wrong for any fork that recompiles the pair, and the failure
is silent: addresses are computed for contracts that do not exist. This fork calls
`IUniswapV2Factory.getPair` instead. It costs one cold `SLOAD` and cannot drift.
`test_pairAddressIsCreate2DerivedFromTheRecompiledPair` pins the reasoning.

**The concrete contracts do not inherit their interfaces.** `UniswapV2Pair`,
`UniswapV2Factory` and `UniswapV2Router02` are standalone; the `I*` files exist for
external consumers. This avoids a class of 0.8 `override` friction on public state
variables that implement interface functions. The risk of drift is covered by
`test_deployedContractsAnswerTheirPublishedInterfaces`, which calls the entire published
surface through the interface types.

## Omitted from the periphery

`UniswapV2Router02` keeps the token-to-token surface and drops:

- **every ETH path, and WETH9 with them.** Arcaidia swaps ERC-20 to ERC-20 only, and on
  Arc the native token *is* USDC, so a wrapper would model something that does not exist.
- **the fee-on-transfer variants.** Both chains' USDC and all four mocks are plain
  ERC-20s. Shipping that path would claim support for a token this market cannot hold.

The pricing, deadlines, slippage bounds and the `k` invariant are untouched.
