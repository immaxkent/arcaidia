# WP-01 completion report

**Date:** 2026-09-04 · **Gate:** met (see the one caveat in §6) · **Next:** WP-02.

## 1. What exists

```
contracts/
  foundry.toml                       bytecode_hash and cbor_metadata off, Cancun
  src/
    ArcaidiaIntentRouter.sol         source-side commitment and intent creation
    ArcaidiaLiquidityVault.sol       ERC-4626 LP inventory + fill accounting
    SettlementReceiver.sol           canonical settlement routing, both branches
    libraries/ArcaidiaTypes.sol      Intent, FillAuthorization
    libraries/IntentLib.sol          canonical intent id
    interfaces/ISettlementInitiator  the CCTP seam
    interfaces/IFillRegistry.sol     what the receiver needs from the vault
    deploy/ArcaidiaDeployer.sol      atomic CREATE2 deploy + initialize
    deploy/ArcaidiaDeployment.sol    the deployment, as a testable library
    mocks/MockUSDC.sol               six-decimal mintable stand-in
    mocks/MockSettlementInitiator    a settlement transport that can fail
  script/Deploy.s.sol                one script, both chains
  test/                              8 suites
scripts/generate-abis.mjs            emits the ABI barrel into the domain package
packages/domain/src/config/deployments.ts   deployed addresses, one source
```

## 2. Test results

`pnpm test:global` — **green**. It compiles the contracts, checks the ABI barrel
is current, typechecks, then runs all three suites.

| Suite | Tests | Command |
| --- | --- | --- |
| Domain (TypeScript) | 77 | `pnpm test:shared-domain` |
| Contracts, Ethereum as source | 146 | `pnpm test:sc-eth` |
| Contracts, Arc as source | 146 | `pnpm test:sc-arc` |

The contract suites are the *same* tests run with `ARCAIDIA_SOURCE` flipped.
Both directions come from configuration, never from duplicated test files — the
rule the specification applies to the contracts, applied to their tests.

Per-contract: MockUSDC 9, MockSettlementInitiator 8, IntentId 12, IntentRouter 32,
LiquidityVault 34, SettlementReceiver 20, CREATE2 determinism 15, deployment 16.

## 3. Acceptance gate

| Criterion | Status |
| --- | --- |
| Contract unit tests green | Yes — 146, both directions |
| Direction is configuration | Yes — no contract names a chain; source is `block.chainid`, destination is a parameter |
| CREATE2 expected addresses deterministic | Yes, asserted in simulation — see §6 |
| Same implementations deployed as both chains' instances | Yes — one script, one set of contracts |

## 4. Decisions taken while building

**The vault could not inherit OpenZeppelin's `ERC4626`.** That implementation
takes the asset as a constructor argument and holds it as an `immutable`.
Constructor arguments are part of init code and init code determines the CREATE2
address, so with different USDC addresses on the two chains the vault would have
landed on different addresses — silently defeating a WP-01 acceptance criterion.
ERC-4626 is therefore implemented directly, with the asset in storage. A test
asserts that pointing the vault at a different asset does not move it, and a
companion test demonstrates the failure by appending each chain's USDC address to
the creation code as a constructor argument would.

**Exposure records the output amount, not the input amount.** The vault advances
`outputAmount` and canonical settlement returns the larger `inputAmount`. Booking
the smaller figure keeps `totalAssets` flat at fill time and recognises the fee
only when realised, rather than marking LPs up on a settlement that has not
happened. This reproduces the specification's worked example exactly: 100,000
deposited, 99,001 liquid while pending, 100,001 once canonical settlement arrives.

**Deployment must be atomic, so it needed a contract, not just a script.**
No-argument constructors mean configuration arrives through `initialize`, which
leaves a window in which anyone could initialize a fresh deployment and seize it.
`ArcaidiaDeployer` performs the CREATE2 and the initialization in one transaction
and asserts the address against its prediction before returning.

**The deployment logic lives in a library, not the script.** Deployment logic that
only exists inside `forge script` gets verified once, on a live network, with real
funds. In a library, the same code is exercised by the test suite in both
directions first — including the wiring, which is where deployments actually fail.

**CREATE2 parity is used but never depended on.** The router stores its
destination receiver per chain rather than assuming the local address. Parity
stays a convenience; making it implicit would turn it into a correctness
requirement.

## 5. Things the tests caught

- **Solidity memory structs alias.** `Intent memory b = a` does not copy, so every
  intent-id mutation test initially compared a value against itself and passed
  vacuously. Now uses an explicit `_copy`.
- **A vacuous CREATE2 test.** One assertion compared a hash to itself and would
  have passed regardless of the code. Replaced with the property it was meant to
  prove.
- **Three vault tests were advancing past the reserve floor.** The first harness
  bypassed the fill path's checks. Pointing it at the same internal function the
  real `fastFill` will call immediately failed them, which is the point.

## 6. The one caveat on the gate

CREATE2 parity is asserted **in simulation**: same salt, same init code, different
chain IDs, different assets, same resulting address, plus a proof that prediction
never reads `block.chainid`. Asserting it against live Sepolia and Arc RPCs needs
funded deployer keys, which belongs to WP-10. The gate is treated as met on
simulation and re-asserted at real deployment — the deployment script asserts
predicted against actual and fails loudly. Raised for review rather than decided
unilaterally.

## 7. Deliberately not built

Per the plan, these belong to later work packages and are absent by design:

- **Signature verification, expiry, agent nonce, fee caps** — WP-05. The vault has
  the accounting half of a fill (`_recordFastFill`) and no public entry point.
- **The full vault safety matrix** — WP-02, including ERC-4626 rounding direction,
  first-depositor inflation and redemption during an outstanding fill under fuzz.
- **Real CCTP** — WP-10. `ISettlementInitiator` is the seam it will slot into.

## 8. Notes for WP-02

- The vault's `fastFill` entry point does not exist yet; WP-02's matrix will need
  it, so WP-02 and WP-05 overlap more than the original plan assumed. Suggest
  building `fastFill` with signature verification at the start of WP-02 rather
  than deferring it, and treating WP-05 as the agent-side signer plus tamper and
  replay tests.
- `Q10` (fee split between LP, solver and protocol) is still open and WP-02 is
  where it starts to matter.
