# The intent market — permissionless solver network (post-V1, parked)

**Status:** designed, not built — no code, no frontend. **Depends on:** nothing in V1 — see §5.
**Blocks:** nothing. **Roadmap position, fixed:** ships strictly after WP-13 (freeze), as its own
phase — *"solver network production and integration"* — **before** V2 (Uniswap) and V3
(Hedera/x402). Its frontend (the Solver Console, pairing UI) ships as part of this phase, not
before: there is nothing to wire against until the contracts and runtime exist.

Covers the intent market mechanism (§1–6) and the reference solver runtime that makes a
permissionless vault operable — Docker Compose packaging, telemetry, and the operator-pairing
flow (§7). Both are the same phase of work and depend on each other's context, so they live in
one document rather than being split.

## 1. The idea

V1 has one solver, authorised by allowlist. This is the natural extension raised while
scoping the x402 work: **anyone can deploy their own `ArcaidiaLiquidityVault`, fund it with
their own capital, set their own risk parameters, and compete to fill intents.** Arcaidia
becomes a market Solvers plug into rather than a service Arcaidia alone operates.

This document exists so the design is captured precisely, and so nobody has to re-derive it
under time pressure later. **None of it is built. None of it needs to be, for V1.**

## 2. Two structs, not one

**`FillAuthorization`** (exists today, unchanged in shape) — *"execute this exact fill."*
Signed, `ecrecover`-verified, carries the chain-of-custody fields (`sourceChainId`,
`sourceTxHash`) binding it to one verified source commitment. This is reused as-is for the
winning bid's execution instruction.

**A new `IntentOpportunity` struct** (does not exist yet) — *"here's what's biddable, and
what a valid bid must satisfy."* The on-chain-readable half of `Intent` plus a `consumed`
flag: `intentId`, `sourceChainId`, `destinationChainId`, `recipient`, `inputAmount`,
`maxFeeBps`, `deadline`, `consumed`. A solver's off-chain agent reads this via a view
function before constructing a bid.

**Why not one struct.** `FillAuthorization`'s byte layout is locked by a cross-language test —
`packages/domain/src/eip712.ts` and `contracts/src/libraries/FillAuthorizationLib.sol` are
asserted to hash identically, and every signature ever produced is over that exact digest.
Adding a `vault` field to say who is bidding would break that lock and invalidate every
existing signature. It also isn't necessary: which vault is bidding is `msg.sender` when
that vault calls into the market, exactly as `sourceChainId` is already read from
`block.chainid` rather than hardcoded. Direction is data; solver identity is context, not
struct content, for the same reason.

## 3. The market never holds money

`ArcaidiaIntentMarket` is a pure arbitrator: one piece of state,
`mapping(bytes32 => bool) consumed`, and the check that a bid satisfies the user's own
`maxFeeBps` and `deadline`. It never touches a token.

A vault's `fastFill()` gains one internal line, added before its existing logic:

```solidity
market.claimIntent(auth.intentId, auth.outputAmount, auth.feeAmount);
// reverts if another vault already won, or this bid violates the user's constraints —
// otherwise the intent is now globally consumed and this vault has won it atomically.

// everything below is today's fastFill, unchanged: allowlist check, replay, caps, transfer.
_recordFastFill(auth.intentId, auth.recipient, auth.outputAmount);
```

This is **first-valid-fill**: no auction clock, no sealed-bid reveal phase, no window for a
losing bidder's transaction to be front-run into a winning one. It is the simplest of the
mechanisms considered (Dutch auction, sealed quotes, request-for-quote window, first-valid-fill)
and simplest for a concrete reason — nothing about it can go wrong live, which matters more
than optimal price discovery for a first permissionless version.

**Gap found while building WP-10, not yet resolved here.** `consumed: mapping(bytes32 => bool)`
answers "has anyone already won this" but not "which vault won it" — and `SettlementReceiver`
needs the second answer, not the first. Today, with exactly one vault, `SettlementReceiver`
holds one hardcoded `IFillRegistry vault` reference and asks it directly. With many competing
vaults, `settle()` has no fixed vault to ask. The natural fix is the same shape the WP-10 fix
below already takes: widen `consumed` to `mapping(bytes32 => address) filledBy` — `address(0)`
for unclaimed, the winning vault's address otherwise — and have `settle()` read
`market.filledBy(intentId)` instead of one fixed reference. One mapping then answers both "may
this vault claim it" and "who do I reimburse," which is why one contract can do both jobs rather
than needing a second registry alongside it. Not designed in depth here; flagging so it is not
rediscovered under time pressure at market-build time.

**WP-10 also closed a related, narrower gap that this market design should inherit the shape
of.** `ArcaidiaLiquidityVault.fastFill()` now checks `SettlementReceiver.isSettled(intentId)`
before paying out (see `ISettlementCheck`) — without it, an intent nobody fast-filled, already
paid via `settle()`'s fallback branch once the real CCTP mint landed, was indistinguishable from
one nobody had touched, because that branch never touched the vault. A late fill would have paid
the recipient a second time out of LP capital. `market.claimIntent()` will need the identical
check, once, centrally, rather than every vault re-deriving it — the same consolidation the
`filledBy` mapping above is doing for the other half of this problem.

## 4. Standardisation is an interface, not a new library

`FillAuthorizationLib` already is the shared library — canonical EIP-712 hashing, used
identically by every vault today. A permissionless deployment additionally needs a shared
**interface**, `IArcaidiaSolverVault`, so the market and any off-chain tooling can call an
arbitrary third-party vault uniformly — at minimum a `quote(IntentOpportunity) view` and the
existing `fastFill`. Any conforming deployment can join without Arcaidia's permission; the
comparison worth keeping in mind is ERC-4626 itself — one interface, permissionless
deployment, integrators compose against any conforming vault. Fitting, since our vault
already is one.

## 5. What this requires of V1 — checked, not assumed

**Nothing.** Verified against the current contracts before writing this:

- `isAuthorisedSigner` is already `mapping(address => bool)`, not `address public solver` —
  confirmed in `ArcaidiaLiquidityVault.sol`. Adding Solver B/C/D today is
  `setAuthorisedSigner(newSolver, true)`; no migration.
- `fastFill(FillAuthorization calldata, bytes calldata)`'s external signature does not change
  when the market call is added — the market call is internal implementation, not part of the
  ABI. Nothing that imports this function's shape (the frontend, the domain package, the
  solver) needs to change when this ships.
- `Intent`, `AgentDecision`, `VaultState` — everything the frontend's data contracts (§7 of
  `docs/frontend-spec.md`) depend on — are untouched by everything in this document.

**One real code change, when this is actually built, not before.** `intentFilled[intentId]`
currently lives in each vault's own storage as the local source of truth. When the market
arrives, authority over that mapping moves to the market; the vault's own copy becomes a
cache reconciled against it. That is a genuine implementation change to the vault at that
time — but still not an ABI change, so it still does not touch the frontend or the solver's
data contracts.

**Conclusion:** this can be built any time after WP-13, including after V2/V3, without
disturbing anything shipped before it. Nothing needs to be done now to keep the door open —
it already is.

## 6. Deliberately not decided here

- Whether `maxFeeBps` alone is a sufficient bid-selection criterion, or whether the market
  should weigh latency/reliability/liquidity confidence as the ChatGPT-drafted model proposed.
  First-valid-fill sidesteps this for v1 of the market: any bid meeting the user's stated
  ceiling wins by being first, full stop. Scoring across multiple live bids is a genuine
  future refinement, not a blocker to shipping the simple version.
- Solver reputation, historical performance, dynamic pricing — V2.5+ in the roadmap this
  document's source sketched. Out of scope until the simple market is live and used.
- Whether x402 gates *bidding itself* (access to see an opportunity) or only gates *agents
  buying services from other agents while solving* (data, routing, risk assessment). This
  document assumes the latter, for the reason recorded in WP-03's x402 scope: taxing
  competition to fill a user's order has no clear anti-spam justification here, since the
  intents are read openly rather than broadcast at volume. If Sybil/spam pressure on the
  opportunity feed becomes real, revisit.

## 7. The reference solver runtime — Docker, telemetry, operator pairing

An earlier draft of this section conflated two different things and stated the boundary
wrongly: it described Arcaidia authorising third-party operators to run against the shared
House Vault. **That is not correct and is not the design.** Restated precisely:

> **ARCAIDIA CONTROLS THE HOUSE VAULT.**
> **INDEPENDENT VAULT OWNERS CONTROL THEIR OWN VAULTS.**
> **THE INTENT MARKET IS PERMISSIONLESS.**
> **ARCAIDIA DOES NOT AUTHORISE THIRD-PARTY SOLVERS TO USE HOUSE VAULT CAPITAL.**

### V1 — unchanged, and this document does not touch it

V1 has exactly one participant: Arcaidia.

```
Arcaidia House Vault
  owner              = Arcaidia protocol/admin
  liquidity           = Arcaidia's own
  authorised operator = Arcaidia House Solver, and only ever that
```

`setAuthorisedSigner(address, bool) external onlyOwner` (built in WP-02) already does exactly
what V1 needs and **stays exactly as it is** — this document does not add third-party
onboarding to it, does not add a self-service pairing flow to it, and does not change its ABI.
There is no Docker Compose reference deployment, no telemetry, no pairing UI in V1. WP-03's
`/solver` page reads existing `AgentDecision` records from the one House Solver; it has nothing
to do with the runtime described below.

### Post-V1 — every participant, including the House Vault, runs the same way

Once the intent market ships, the House Vault stops being special. It becomes **one participant
among many**, going through the identical permissionless path everyone else does:

```
Arcaidia House Vault        Institution Vault           Individual Vault
  owner: Arcaidia              owner: the institution      owner: the individual
  funded by: Arcaidia          funded by: the institution  funded by: the individual
  operator: Arcaidia's own     operator: their own          operator: their own
        \                            |                            /
         \___________________ same IArcaidiaSolverVault interface _______________/
                                        |
                              races through the shared IntentMarket
                                  first valid fill wins
```

**No approval step exists.** Participation is:

1. deploy a conforming `IArcaidiaSolverVault` (§4)
2. fund it with your own liquidity
3. authorise your own solver operator — on **your own vault**, by **your own** vault-owner call
4. run the reference solver, a fork, or any compatible custom implementation
5. compete through the `IntentMarket`

The only gate is the objective interface/contract-validity check the market itself enforces on
any vault that calls into it (§4) — never a human or protocol decision about *who* may
participate. Arcaidia reviewing or whitelisting a third party's operator key is explicitly
outside this design.

### Telemetry pairing — corrected, two separate lifecycles

`TELEMETRY PAIRED` and `SOLVER AUTHORISED` remain distinct facts, as originally specified:

- **`TELEMETRY PAIRED`** — the runtime has proven it controls the claimed operator key. Grants
  **zero** protocol execution rights on its own, in either lifecycle below.
- **`SOLVER AUTHORISED`** — the relevant vault's owner has granted that operator address onchain
  authority over *that specific vault*. Only this grants execution rights.

**V1 lifecycle** (internal to Arcaidia; no third party ever reaches this flow):
telemetry identifies the Arcaidia House Solver runtime → the Arcaidia protocol owner authorises
that operator against the shared House Vault. There is no self-service path here for anyone
else, by design.

**Post-V1 permissionless lifecycle** (every participant, House Vault included):
the independent vault owner logs in through Privy → deploys and funds their own SolverVault →
starts the Docker Compose solver + telemetry stack → telemetry proves possession of that
operator key → **that same vault owner** authorises the operator on **their own vault** →
`SOLVER AUTHORISED`. No protocol-admin approval appears anywhere in this sequence.

```
deploy/fund YOUR vault
  → frontend generates non-secret runtime config (VAULT_ADDRESS, CHAIN_ID, RPC_URL, ...)
  → docker compose up -d
  → solver loads/creates its operator key
  → telemetry registers with the Relay, signs a challenge bound to {vaultAddress, operatorAddress}
  → console shows "SOLVER DETECTED — operator: 0x..."      (TELEMETRY PAIRED, zero rights)
  → YOUR vault's owner calls setAuthorisedSigner(operatorAddress, true) — or the eventual
    equivalent, see the naming note below — on YOUR OWN vault, nobody else's
  → console reads authorisation directly from YOUR vault contract (authoritative, not telemetry)
  → SOLVER AUTHORISED / LIVE
```

**History attaches to the vault, never the operator key.** Rotating or revoking a signer via
`setAuthorisedSigner` (already supported, already tested in WP-02) does not fragment a vault's
fill/fee/settlement history, because that history is already indexed by vault address, not by
signer (WP-08's subgraph schema).

**On the primitive's name — a decision explicitly left open.** `setAuthorisedSigner(address,bool)`
is adequate for V1 and must not be changed there merely for naming symmetry with what comes
later. For the permissionless vault, the same owner-scoped primitive can be reused as-is per
vault — nothing forces a rename. Clearer semantics (`setSolverOperator()`, a `SOLVER_ROLE`) are
a legitimate option *at that time*, weighed against the vault interface's stability once
third parties are integrating against it. Not decided now; not blocking anything now.

### Components (unchanged in shape from the earlier draft, now correctly scoped to post-V1 only)

- **`arcaidia-solver`** — the solver loop (`processIntent`, `ObservationProvider`,
  `SettlementAdapter`, `AgentAuthority` — all exist today from WP-05/06/08/09), packaged to run
  unattended against **whichever vault its operator points it at**: watches the market for
  intents, independently verifies source RPC (unchanged — WP-04.9's rule holds exactly as
  built), reads that vault's own state, decides, signs, submits. Owns its own operator key —
  an EOA, or a Circle Agent Wallet (WP-09's `AgentAuthority` already abstracts this).
- **`arcaidia-telemetry`** — a sidecar with **no vault custody, settlement, or execution
  authority**. Forwards lifecycle events, sends outbound HTTPS to the Relay, authenticates via
  the solver operator key. Cannot move funds by construction.

**Telemetry is observation, never authorisation — the same rule WP-08 already applies to The
Graph, one level up the stack.** If the Relay is offline, every conforming solver — House or
independent — keeps discovering, verifying, deciding, filling, and receiving reimbursement
exactly as the WP-07 golden run proves. Only the console's live view degrades. Every telemetry
event is provisional and is overridden by onchain/market state the moment that state exists:
`tx_submitted` → RPC receipt; `fill_won`/`fill_lost` → the market's consumed-intent event;
settlement, fees, volume → onchain accounting, never the telemetry stream.

**Transport:** outbound-only, `solver → telemetry sidecar → HTTPS → Relay`. No inbound ports on
any solver, no NAT traversal, no publicly exposed solver API — true for the House Solver and
every independent one alike. Frontend subscribes via SSE
(`GET /v1/telemetry/vault/{vault}/stream`); Relay surface is `pair` / `heartbeat` / `events`.

**Reference runtime configuration** (non-secret half generated by the frontend; the operator
key itself is generated or loaded locally by the container, never emitted to frontend JS, a
URL, or a copy-paste pairing link):

```
VAULT_ADDRESS, CHAIN_ID, RPC_URL, GRAPH_ENDPOINT
ARCAIDIA_API_BASE_URL, ARCAIDIA_TELEMETRY_URL
SOLVER_KEY  |  Circle Agent Wallet config          # AgentAuthority — WP-05/WP-09, unchanged
TELEMETRY_ENABLED=true                              # on by default; solver is correct if false
X402_ENABLED, x402 client config                    # optional
RISK_POLICY_CONFIG, LOG_LEVEL
```

**Open question, raised 2026-09-10, decide before this section leaves "parked":** should a
Circle Agent Wallet stop being optional here and become the *only* accepted `AgentAuthority`
for a permissionless solver, once V1 has shipped? The case for it: every fill Circle signs is
sanctions-screened before submission (Q5), which today is a control this permissionless design
otherwise lacks entirely — anyone can point a solver at the market with a bare private key, no
screening, no accountability beyond the vault's own onchain allowlist. Mandating Circle Wallets
would be a real, second layer of protection specifically at the point this market intentionally
opens up to strangers.

The honest complications:
- **Not enforceable onchain.** `isAuthorisedSigner` only ever sees a recovered ECDSA address —
  the contract cannot tell a Circle-custodied key from a raw one; Circle wallets are ordinary
  EOAs from the chain's perspective. "Require Circle" would have to be an admission-time policy
  wherever the permissionless registry actually grants a new operator's signer, not a rule the
  protocol itself can check.
- **Real tension with "permissionless."** This section's own thesis is open participation; a
  mandatory third-party custody/compliance product is, in effect, "permissioned via Circle" —
  worth naming plainly rather than let the wording carry a contradiction.
- **A vendor-uptime and vendor-policy dependency** the rest of the architecture deliberately
  avoids — the vault's own onchain caps are enforced independent of any one custody provider;
  this would add one back, specifically for the actor set (independent solvers) least equipped
  to absorb a screening false-positive or an API outage.

On the mainnet-access worry that prompted this: checked Circle's docs — Wallets/Agent Wallets
production (`LIVE_API_KEY`) access reads as self-service (generate the key from the same
console page once ready), distinct from **Circle Mint**, the fiat-rail product that does require
KYB. Worth confirming directly against the console once Arc mainnet is live (2026-09-16) rather
than assuming either way — but nothing found suggests Agent Wallets specifically is unreachable
for this hackathon's timeline.

### Sub-tasks (none started — this entire section is post-V1)

- [ ] The `IntentMarket` contract and `IArcaidiaSolverVault` interface (§3–4) — prerequisite to
      any of the below; nothing here is buildable before that exists.
- [ ] Package the existing solver loop as `arcaidia-solver`, parametric on which vault it is
      pointed at — no new decision logic.
- [ ] Build `arcaidia-telemetry` — event forwarder + heartbeat, outbound HTTPS only.
- [ ] Docker Compose reference stack, `TELEMETRY_ENABLED=true` default.
- [ ] Relay: `pair` / `heartbeat` / `events`, SSE stream per vault.
- [ ] Frontend, built only once the above exists: config generator, Solver Console state machine
      (`SCANNING → INTENT DISCOVERED → VERIFYING SOURCE → FORMULATING FILL → SUBMITTED →
      FAST FILL CONFIRMED → AWAITING CCTP → SETTLED`, `LOST RACE → SCANNING`), the
      `SOLVER DETECTED → SOLVER AUTHORISED` transition reading authorisation directly from the
      relevant vault contract.
- [ ] Migrate the House Vault to participate through the same path as everyone else, once it is
      ready to stop being the sole participant.
- [ ] Kill-the-Relay test: the full fill/verify/decide/submit/reimburse cycle passes with
      `TELEMETRY_ENABLED=false` and the Relay unreachable, for both the House Solver and an
      independent solver. This is the gate.

### Acceptance gate (this section only)

Any independent participant can go from `docker compose up -d` against their own freshly
deployed and funded vault to `SOLVER AUTHORISED / LIVE`, using only steps they control — no
Arcaidia approval anywhere in that path — **and** the golden-run-equivalent lifecycle passes
unmodified with telemetry disabled or the Relay offline, for both the House Solver and an
independent one.
