# WP-00 completion report

**Date:** 2026-09-04 · **Gate:** met · **Next:** WP-01, pending review of this report.

## 1. Files and packages created

```
package.json                pnpm workspace root (node >=22, pnpm 10.2)
pnpm-workspace.yaml         packages/* and apps/*
tsconfig.base.json          ES2022, strict, noUncheckedIndexedAccess,
                            exactOptionalPropertyTypes, verbatimModuleSyntax
.env.example                every variable named; no secrets, no addresses
.gitignore

packages/domain/
  src/types/primitives.ts   Address, Hex, TxHash, Bytes32, UnixSeconds, Bps
  src/types/status.ts       the dual settlement state model
  src/types/intent.ts       IntentParams, Intent
  src/types/fill.ts         FillAuthorization, SignedFillAuthorization
  src/types/decision.ts     Verdict, DecisionReason, DecisionInputs, AgentDecision
  src/types/risk.ts         RiskPolicy, SettlementRiskPolicy, fee curve, tiers
  src/types/settlement.ts   SettlementStatus, SettlementReference, SettlementState,
                            SettlementHealth, VaultState + derivations
  src/config/chains.ts      ChainConfig table — the only home for chain-specific values
  src/config/routes.ts      resolveRoute / resolveEndpoints
  src/intent-id.ts          computeIntentId, INTENT_TYPEHASH
  src/eip712.ts             FillAuthorization typed data, domain, digest
  src/ports.ts              ObservationProvider, AgentAuthority, SettlementAdapter
  src/errors.ts             ArcaidiaError + 30 error codes
  src/abis.ts               barrel, populated by WP-01
  src/index.ts              public surface
  test/                     6 suites (see §3)
```

Sole runtime dependency: `viem`. No package imports another Arcaidia package yet,
because none exists yet — that is the point of building this first.

## 2. Domain types and schemas

**Dual settlement state.** `FastStatus` (`PENDING | FAST_FILLED`) and
`CanonicalStatus` (`PENDING | SETTLED`) are separate types on
`IntentSettlementState`, plus `CanonicalOutcome` (`LP_REIMBURSED | RECIPIENT_FALLBACK`)
recording where canonical funds went. There is no combined state. The three
predicates are deliberately non-overlapping questions:

- `isRecipientPaid` — has the user got their money (fast fill *or* canonical fallback)?
- `isCanonicallyFinal` — has economic finality been reached?
- `isLpExposed` — is LP capital advanced and unreimbursed?

`describeSettlementState` renders all four cells of specification §9 in one place.

**Direction as data.** `Intent` carries `sourceChainId` and `destinationChainId` as
ordinary fields. `resolveRoute(sourceChainId, destinationChainId)` returns
`{ source, destination }`; `resolveEndpoints(route)` returns the source router,
destination vault and destination settlement receiver. No type, constant or
function anywhere names a chain pair. Mirroring an intent is swapping two fields.

**Intent identity.** `computeIntentId` is `keccak256(abi.encode(INTENT_TYPEHASH,
sender, recipient, inputToken, amount, sourceChainId, destinationChainId,
maxFeeBps, deadline, nonce))`. The typehash is domain-separating so an id cannot
collide with an unrelated `abi.encode` of the same shape. WP-01 adds the Solidity
differential test.

**EIP-712.** `FillAuthorization` typed data with the nine fields the specification
requires. The domain binds `chainId` **and** `verifyingContract`. This matters more
here than in a typical protocol: we deliberately deploy identical vault bytecode
to identical CREATE2 addresses on both chains, so without both bindings one
signature would be valid against both vaults. Two tests cover exactly that.

**Settlement and risk state, Circle-free.** `SettlementHealth` carries
`transport: HEALTHY | DEGRADED | UNAVAILABLE`, `oldestUnsettledAgeSeconds`,
`pendingValue`, `averageSettlementLatencySeconds` and `latencySampleSize` — the
four signals the eventual policy needs, in protocol-neutral terms. `RiskPolicy`
holds every threshold including the settlement-response block, so WP-04 contains
no magic numbers. No Iris or Circle response shape appears above the adapter
boundary; the guard test enforces it.

**Ports, provisional where they should be.** `AgentAuthority` is a discriminated
union of `SigningAuthority` (`kind: 'sign'`) and `ExecutingAuthority`
(`kind: 'execute'`), marked `PROVISIONAL` in the file header with the reason. Q4's
answer points at `sign`; the residual EOA-vs-SCA question is why the other shape
stays until WP-05 confirms it onchain.

## 3. Tests and results

`pnpm --filter @arcaidia/domain test` — **57 passed, 6 files, 0 failures.**
`tsc --noEmit` — clean under strict mode.

| Suite | Tests | Covers |
| --- | --- | --- |
| `intent-id` | 14 | determinism, key-order independence, direction distinguishes ids, one test per mutated field, encoding lock fixture |
| `eip712` | 14 | domain construction, digest stability, signature recovery, cross-chain and cross-vault replay separation, one test per bound field |
| `routes` | 13 | resolution, symmetry, same-chain rejection, unconfigured-chain rejection, config completeness, distinct domains, single CREATE2 factory |
| `status` | 5 | four distinct §9 descriptions, independence of the two axes, LP exposure, "fast-filled is not finished" |
| `vault-state` | 6 | reserve floor exclusion, no negative liquidity, utilisation curve, empty-vault divide-by-zero |
| `vocabulary` | 5 | executable guards (below) |

The `vocabulary` suite scans `src/**` with comments stripped and fails the build
on: a collapsed completion identifier (`completed`, `isComplete`, `isDone`, …); a
hardcoded direction (`ETH_TO_ARC`, `processEthToArc`, …); a runtime asset switch
(`useRealUSDC`, `MOCK_MODE`, …); or a sponsor-specific type in the domain
(`IrisMessage`, `PrivyUser`, …). Three of your six hard requirements are now
enforced by CI rather than by review.

The `intent-id` lock fixture pins the encoding to
`0xfdff8f70…dbb9c8` for a known intent. If the Solidity implementation or the
TypeScript encoding drifts, that test fails rather than silently re-keying every
indexed intent.

## 4. CREATE2 and configuration approach

**Parity is achievable and verified.** Arachnid's deterministic deployment proxy is
live at `0x4e59b44847b379578588920cA78FbF26c0B4956C` on both Ethereum Sepolia and
Arc testnet — identical bytecode returned by `eth_getCode` on each. Arc implements
`CREATE2` with Ethereum-identical behaviour. `create2Factory` is a field on
`ChainConfig` and a test asserts every chain resolves to the same factory.

**The rule for WP-01:** constructor arguments must be byte-identical across chains,
because they are part of the init code and therefore of the address. Chain-specific
values — USDC address, CCTP domain, transport contracts, peer addresses — are
applied by a post-deploy `initialize` guarded to a one-time call by the deployer.

Convenient finding: CCTP V2 contracts sit at *identical* addresses on both testnets,
so they could safely be constructor arguments. **Do not rely on that** — it does not
hold on Ethereum mainnet, and depending on it would silently break the pattern the
day we move networks. Route them through `initialize` like everything else.

**Asset configuration.** `settlementAsset` is a `TokenConfig` on `ChainConfig`.
Selecting MockUSDC or real USDC is an edit to that field and nothing else. No
runtime switch exists, and the guard test fails the build if one is introduced.

## 5. Answers to Q1/Q2/Q4/Q6

Full detail with source links is in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). Summary:

- **Q1 — Arc.** Target Arc **testnet**: chain ID `5042002`, RPC
  `https://rpc.testnet.arc.io`, explorer `https://testnet.arcscan.app`, USDC as the
  18-decimal gas token, sub-500ms finality. `CREATE2` and `PUSH0` behave as on
  Ethereum. Mainnet launches 2026-09-16 — after the build window opens, and it
  has no CCTP deployment yet.
- **Q2 — CCTP.** V2 on both chains. Ethereum domain `0`, **Arc testnet domain `26`**.
  V2 contracts at identical addresses on both testnets. Iris sandbox at
  `https://iris-api-sandbox.circle.com`, `GET /v2/messages/{domain}?transactionHash=`,
  40 req/s. Circle documents Ethereum→Arc; the reverse is inferred from contract
  presence and must be proven in WP-10.
- **Q4 — Agent Wallet.** Signs EIP-712 typed data and returns a raw signature
  (`circle wallet sign typed-data`, and `POST /v1/w3s/developer/sign/typedData`).
  `ARC-TESTNET` is a supported blockchain. **Recommendation: the vault authenticates
  a recovered EIP-712 signer against an allowlist, not `msg.sender`.** Residual:
  provision the wallet as an EOA, since an SCA would need EIP-1271 and has a
  lazy-deployment gotcha.
- **Q6 — The Graph.** Supports `arc-testnet` (`eip155:5042002`, protocol `ethereum`)
  and `sepolia`. **No Substreams or self-hosted node needed.** Architecture: one
  subgraph per chain, joined client-side on `intentId`, with per-chain staleness
  exposed to the risk engine.

## 6. Contradictions between the specification and current infrastructure

**1. Mainnet is not available, so "prefer production" cannot be honoured.**
Arc mainnet launches **2026-09-16**, and Circle's CCTP documentation lists Arc
**testnet only** — no mainnet CCTP deployment, no mainnet Arc contract addresses.
Targeting mainnet is impossible today and would remain unproven infrastructure
even after the 16th. **Decision: build on Ethereum Sepolia ⇄ Arc testnet.** This
is not a hackathon shortcut; it is the only environment where the bidirectional
path exists. Worth revisiting only if Arc mainnet ships CCTP well before submission
and the demo is already reliable on testnet.

**2. Arc may not support CCTP Fast Transfer.** Circle's supported-chains table lists
Arc testnet with Standard transfers, upfront fees and forwarding — Ethereum
additionally lists Fast. If Arc genuinely lacks Fast Transfer, the Ethereum→Arc
canonical leg waits for **finalized** (threshold 2000), i.e. Ethereum hard finality
of roughly 13–19 minutes. This *strengthens* the product thesis — the gap Arcaidia
fills is larger — but it must be verified in WP-10 and stated honestly in the demo
rather than quietly assumed either way.

**3. USDC is Arc's gas token, which the specification does not anticipate.** On Arc,
the settlement asset and the gas asset are the same thing, exposed as an ERC-20
facade at `0x3600…0000` (6 decimals) over an 18-decimal native balance. Three
consequences: WP-01 must confirm the facade implements full `approve`/`transferFrom`;
WP-02 must not assume vault inventory and gas are independent balances; and the
solver must hold a gas buffer that is *also* denominated in the asset it is
advancing. None of this breaks the design — the protocol still sees one configured
IERC20 — but it is a real operational difference the specification does not mention.

**4. "Arc requires no LP vault when Ethereum is source" is inconsistent with the
bidirectional-from-day-one requirement.** Specification §10 says only the
destination needs fast-fill inventory, then §16.2 requires both chains to be
symmetric and either to be source. The second reading is the operative one and the
one the work packages follow: **both chains get a funded LiquidityVault.** Flagging
it because §10 reads as licence to fund one side, and doing so would fail WP-02's
gate on the first reverse-direction test.

## 7. Architectural decisions to review before WP-01

1. **Confirm the testnet decision.** Everything downstream assumes Sepolia ⇄ Arc
   testnet. It is the only viable target today, but it is your call to ratify.
2. **Ratify the vault's authentication model** — recovered EIP-712 signer against an
   allowlist, per Q4. This decides `ArcaidiaLiquidityVault.fastFill`'s signature and
   whether `ExecutingAuthority` survives. I have not designed the vault; I am asking
   for the decision before I do.
3. **Provision the Circle agent wallet as an EOA, early.** Not at WP-09. A five-minute
   check now removes the only remaining risk of a WP-05 rewrite.
4. **Decide whether the router's CCTP initiation uses `depositForBurn` directly or a
   forwarding variant.** Circle lists "forwarding service" support on both chains;
   if it can deliver straight to `SettlementReceiver`, the reconciliation path in
   WP-06 simplifies. Needs a WP-01 spike.
5. **Accept the two-subgraph architecture** (Q7) so WP-08 has no design left to do.
6. **Set the confirmation policy (Q9) against the real finality numbers.** If Arc
   lacks Fast Transfer, the honest demo threshold is a low testnet confirmation count
   with the reasoning stated aloud — not a number chosen to make the demo look quick.

Nothing here requires changing what WP-01 builds. Items 2 and 3 change how it is
built, which is why the gate stops here.
