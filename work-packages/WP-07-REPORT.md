# WP-07 completion report

**Date:** 2026-09-05 · **Gate:** met · **Next:** WP-08.

## 1. Gate

> The complete economic lifecycle passes deterministically before any external
> sponsor integration is required. Green in CI, from clean, in both directions.

Met.

```
pnpm e2e          the golden run alone
pnpm test:global  everything, including it
```

**`test:global` green: 94 domain, 165 agent, 55 settlement, 246 contract tests
run twice, and 21 end-to-end.** Nothing reaches the network.

## 2. What the golden run does

Two anvil instances with the real chain ids. The full protocol deployed to both
through CREATE2 — with the addresses asserted identical across two *running*
chains, which is the WP-01 criterion that had only been proven in simulation.

Then, for each direction:

| Step | Asserted |
| --- | --- |
| Intent created | Funds committed, `IntentCreated` carries a settlement reference |
| Solver runs | Verified against RPC, priced, signed, submitted |
| Fast fill | Recipient holds input minus fee; vault's total assets unmoved |
| Mid-flight | Vault carries the receivable; liquid balance down by the output |
| Attestation pending | Worker reports WAITING, nothing marked settled |
| Canonical settlement | Principal returns; vault ahead by exactly the fee |
| Books | Fee split 50/50 — treasury's half excluded from LP assets |

Plus the fallback in both directions: no solver, and the recipient is paid in
full with no LP capital ever at risk and nothing left in the receiver.

Plus refusals — fee ceiling, transport unavailable, and an intent the chain has
already filled — each asserting the *whole world* is unchanged rather than
merely that the verdict was negative.

## 3. The ten invariants, as a checklist

`tests/e2e/test/invariants.test.ts` asserts all ten from the work-package index
together, against two running chains. Two are worth calling out:

**Invariant 2** offers an already-filled intent again through a stale
observation and a fresh journal, so nothing local remembers the first fill. The
vault refuses anyway. The solver's bookkeeping is a convenience; the contract is
the guarantee.

**Invariant 9** lies to the solver — an observation claiming ten million USDC of
liquidity — and confirms it still cannot spend what the vault does not have.
That is the Graph-compromise scenario, tested rather than argued.

## 4. Three real bugs, all found by the harness

**viem caches the chain head.** `getBlockNumber` is cached for the polling
interval, so a head one block stale reads as *fewer* confirmations than the
chain has. The same intent was accepted in one direction and declined for
`INSUFFICIENT_CONFIRMATIONS` in the other, purely on cache timing. Now read with
`cacheTime: 0`. This would have been maddening in production: intermittent
rejections that look like policy.

**Settlement outcomes were misread.** `decodeEventLog` given an explicit
`eventName` decodes whatever it is handed without checking the log is that
event, so the try-each loop reported whichever it tried first. **Every recipient
fallback was silently recorded as an LP reimbursement.** Now matched on
`topics[0]`, with seven tests.

**The mock transport moved no money.** Real CCTP mints to the receiver when
completing; the mock only kept books, so the receiver held nothing and
settlement reverted. Completion now delivers before recording receipt, so a
failed delivery leaves the message retryable rather than believing funds arrived.

## 5. Two harness lessons worth keeping

**Two clocks drift, silently, in both directions.** A harness clock ahead of
chain time makes fresh intents look old and attestations instantly ready; behind
it, signed authorizations expire before they land. Both were observed. The clock
is now derived from chain time and re-synced after every advance.

**A taken port fails confusingly.** anvil exits and the harness connects to
whatever was already there, deploying at different nonces — surfacing much later
as a mismatched CREATE2 address with nothing pointing at the cause. It now
refuses a chain with history and names the remedy.

## 6. CI

`.github/workflows/ci.yml` runs `test:global` on every push: contract build, ABI
staleness, typecheck, all four unit suites, both contract directions, and the
two-chain golden run. It reaches no network, so a sponsor outage cannot turn CI
red.

## 7. Why this gate mattered

Everything from here replaces exactly one mock with one sponsor service. The
Graph at WP-08, the Circle Agent Wallet at WP-09, real CCTP at WP-10. Because
the lifecycle is proven without any of them, a failure after this point is
attributable: if the golden run still passes, the fault is in the integration
rather than in Arcaidia.
