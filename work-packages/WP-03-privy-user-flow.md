# WP-03 — Privy thin user flow (M3)

**Objective:** a real Privy wallet creates a real intent, in either direction, through the UI.
Deliberately early: the human flow must evolve alongside the protocol, not be bolted on at the end.

**Depends on:** WP-01 (ABIs + addresses). **Parallel with:** WP-02, WP-04.
**Stack:** Next.js, React, TypeScript, Privy, viem.

## Sub-tasks

- [ ] **3.1 Next.js app** in `apps/web`, importing types and config from `packages/domain`.
      No address, ABI or chain constant defined locally.
- [ ] **3.2 Privy auth + wallet.** Login, wallet provisioning, chain switching. Resolve Q8 first:
      embedded vs external wallet, and whether Privy can sign for Arc.
- [ ] **3.3 Intent form.** Source chain, destination chain, amount, recipient, max fee (bps),
      deadline. **One component pair for both directions** — a swap-direction toggle, never two
      screens. Live USDC balance for the selected source chain.
- [ ] **3.4 Approve + submit.** ERC20 approve (or permit if available) then `createIntent`.
      Surface the source tx hash with an explorer link immediately.
- [ ] **3.5 Status timeline.** Five distinct visual states: `COMMITTED` → `OBSERVED` →
      `DECISION (accept/reject + fee)` → `FAST_FILLED` → `SETTLED`. Fast and canonical status are
      rendered as **two independent tracks**. Never a single progress bar that reaches 100% at
      fast fill.
- [ ] **3.6 Agent decision panel.** Show the actual inputs the agent used — available liquidity,
      utilisation, outstanding exposure, settlement backlog, quoted fee vs the user's ceiling.
      This is the demo's money shot; build the surface now even if the data is stubbed until WP-04.
- [ ] **3.7 Failure states.** Rejected intent (with reason), expired deadline, no-solver fallback
      in progress, RPC unavailable. No silent spinners.

## Tests

- Component tests: the direction toggle produces mirrored, valid intent payloads.
- The status view cannot render "complete" from fast state alone — assert this explicitly.
- A manual scripted run: Privy login → intent created on chain A → visible on chain A explorer,
  then repeated with the chains swapped.

## Acceptance gate

A real Privy wallet can create an intent in either direction through the UI, and the resulting
transaction is visible onchain.

## Traps

- Collapsing `FAST_FILLED` and `SETTLED` into "Done". Explicitly forbidden by the spec and a
  likely judge question.
- Two route trees (`/eth-to-arc`, `/arc-to-eth`). Same components, direction as state.
- Deferring the decision panel to WP-12 — it is what makes the agent visible, and late UI work
  is where hackathon submissions die.
