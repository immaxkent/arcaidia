# WP — ERC-4626 Substreams module (The Graph P1)

**Status:** DONE. Published, live, verified. Branch `erc4626-substreams`. **Targets:** The Graph P1 — Best Use of
Composable or Standardized Graph Products, $5,000. **Deadline:** submission closes Sunday
2026-09-13, 12:00pm EDT (verified against the live ETHGlobal rules page, not a secondhand date).
**Depends on:** nothing. **Runs in parallel with:** the intent market work (separate fork/agent) —
confirmed no shared surface, see §1.

## Progress (updated as it lands — see branch history for detail)

- [x] §5.1–5.2 `map_vault_flows` — generic Deposit/Withdraw decoding, 20/20 tests including a
      real fixture pulled from Arcaidia's own Sepolia vault via `cast logs`, plus full
      block-aggregation-loop coverage (multiple vaults/transactions per block, reverted
      transactions correctly excluded). Wasm build + pack both green.
- [x] **§5.3 — fully done, both halves.** API key provisioned 2026-09-11
      (`SUBSTREAMS_API_KEY` in `.env`). Ran `substreams run` against the real, live Ethereum
      Sepolia Firehose endpoint, bounded to a single block (block 11675763 — the block containing
      Arcaidia's own real deposit; 1.3 KiB egress, negligible usage). Result, saved permanently at
      `erc4626-vault-flows/verification/sepolia-block-11675763.json`: the module decoded **four**
      deposits in that one block — Arcaidia's own (values match the independent `cast call
      totalSupply()` check exactly) and **three from vaults this project has never seen or
      configured**. This is the strongest evidence yet for the WP §2 genericness bar: live, against
      real strangers' vaults, not asserted or only exercised against a synthetic test address.
- [x] **§5.4 — done. Published, live, public.** The registry token (from `https://substreams.dev/me`,
      a separate credential from the Firehose `SUBSTREAMS_API_KEY`) needed an interactive terminal
      form (`huh`) with no TTY available here — worked around cleanly with `expect` driving a real
      pty (`~/.config/substreams/registry-token` also needed its parent directory created; the CLI
      doesn't do this itself). Published, then republished once more as v0.1.1 after correcting the
      README's `graph_out` section for §5.5's finding below (see that commit). Live at
      **https://substreams.dev/packages/erc4626-vault-flows/v0.1.1** — public, under the user's own
      account, zero Arcaidia-specific configuration required to run it.
- [x] **§5.5 — the originally planned Studio-subgraph route is dead, decision made.** Studio
      subgraph `arcaidia-vault-flows` was created via the dashboard 2026-09-11 and deploy was
      attempted for real. Result: `Substreams-powered Subgraphs, originally intended for non-EVM
      chains, are no longer supported.` **Not an EVM-vs-non-EVM issue** — confirmed against
      graph-node's own NEWS.md that this integration was removed platform-wide, for every chain,
      regardless of type; the error's wording about "originally intended for non-EVM chains"
      describes the feature's *original* motivation, not a surviving EVM-only carve-out. No further
      engineering on this repo fixes it. The code (`graph_out`, `vault-flows-subgraph/`) is real,
      tested, and correct — kept in the repo as evidence it reached exactly the platform's removal,
      not a bug.
      **Decision (user, 2026-09-11): skip building a SQL-sink composability demo, rely on the
      standalone-contribution route instead**, given the deadline. This is directly supported by the
      prize text itself, not a stretch: *"Contributing a new composable Substreams module for an
      emerging standard, such as ERC-4626 tokenized-vault flows, also counts."* §5.4's publish
      satisfies exactly this — a genuinely generic, live-verified-against-strangers'-vaults,
      published package. `BOUNTY-REQUIREMENTS.md` needs its Graph P1 row updated to reflect this is
      no longer "fully unaddressed."
- [x] §5.6 docs on what became easier — written into `erc4626-vault-flows/README.md`, grounded in
      what actually happened building this (no per-vault mapping code, the same decoder proven
      generic by a dedicated test, the whole integration reducing to vendoring one canonical
      schema) — and now further reinforced by §5.3's live cross-vault evidence above.

## 1. Why this doesn't collide with the intent market work

Checked directly, not assumed. This module reads the **standard ERC-4626 interface only**:
`deposit`, `withdraw`, `mint`, `redeem`, the `Deposit`/`Withdraw` events, `convertToShares`/
`convertToAssets`. `ArcaidiaLiquidityVault` already implements all of it, unchanged since the
percentage-cap redesign. `WP-INTENT-MARKET.md` §5 audited whether the market touches any of
this and found it doesn't — the market adds one internal line inside `fastFill()` (not part of
the ERC-4626 standard) and a new, separate `ArcaidiaIntentMarket` contract. Two disjoint surfaces.
The one mechanical link: `fastFill()` changing means a new vault deployment when the market ships
(no proxy/upgrade path exists here). A properly generic module (§2) tracks event *signatures*,
not one hardcoded address, so that redeploy is a non-event for it.

## 2. The bar this has to clear

**A stranger's ERC-4626 vault, with zero Arcaidia-specific configuration, must get real value
from this module.** Not a copy of Arcaidia's own subgraph mappings relabeled "generic" — the
prize text draws exactly this line (*"Simply querying one Subgraph with no composition or
standardization does not qualify"*), and a package that's secretly project-specific reads as
worse than not submitting at all. If time pressure forces a shortcut here, stop and fall back to
Route A (below) rather than ship a module that fails this test.

## 3. The hard constraint that shapes scope

**Arc has zero Firehose/Substreams support** — checked directly against The Graph's own network
registry (`substreamsSupportLevel: "none"`, `firehoseSupportLevel: "none"` for both `arc` and
`arc-testnet`). Substreams is built on Firehose; no Firehose means no Substreams module is
possible for that chain, at any effort level. **This module can only ever target Ethereum
(Sepolia today, `mainnet` id also fully supported)** — full support confirmed there
(`substreamsSupportLevel: "full"`). Not a gap: both chains run identical `ArcaidiaLiquidityVault`
bytecode (WP-01's symmetric-core design), so a genuinely generic module covers Arcaidia's own
Ethereum-side vault as one instance among any others, which is exactly what the prize wants.

## 4. Toolchain — new to this codebase

Rust + Protobuf, not TypeScript/Solidity. `substreams` CLI, `PROST!` for codegen, a WASM build
target. Nothing here reuses the existing agent/settlement/contracts stacks directly; treat setup
friction as the main schedule risk, not the logic itself (§7 fallback exists for exactly this).

## 5. Scope

1. **Protobuf schemas** (`proto/erc4626.proto`) — generic message types for a Deposit event, a
   Withdraw event, and a vault-state delta (`totalAssets`, `totalSupply` at the block). No
   Arcaidia-specific fields (no `outstandingExposure`, `reserveFloor`, `maxFillBps` — those are
   Arcaidia extensions beyond the standard and do not belong in a generic module).
2. **Rust map module(s)** — decode `Deposit`/`Withdraw` log topics matching the standard ERC-4626
   event signatures from raw Ethereum blocks, for *any* emitting address, not a hardcoded list.
   Optionally a second module deriving running vault-state deltas from those events.
3. **Local verification** — run the module against a block range covering Arcaidia's own real
   Sepolia vault deposits/fills from this session, confirm the decoded output matches known
   on-chain reality. This is the module's own test, not a mock.
4. **Package and publish** — build the `.spkg`, publish to the Substreams Registry
   (`substreams.dev`). This artifact — public, reusable, address-agnostic — is the actual
   contribution the prize is judging.
5. **Wire it back in** (composability evidence, not optional flourish) — point a subgraph's
   `subgraph.yaml` at the published package as its data source (a `substreams-powered subgraph`),
   deployed to Studio alongside the two existing subgraphs. This is what turns "we published a
   package" into "we composed two Graph products," which is P1's own stated qualifying bar.
6. **Docs** — a short README in the module's own directory: what it indexes, how another
   ERC-4626 vault (anyone's) consumes it, and — per the prize text's own ask — what became
   *easier* because a standardized schema was used instead of a project-specific one.

## 6. Explicitly out of scope

- Anything on the Arc side (§3 — impossible, not deferred).
- Any Arcaidia-specific field or event (`FillAuthorization`, `IntentCreated`, `fastFill`) —
  those belong to Arcaidia's existing project-specific subgraphs, not this module.
- Changing `ArcaidiaLiquidityVault` itself — the ERC-4626 surface this reads is already complete.
- Any coordination with the intent-market fork beyond what §1 already establishes.

## 7. Time-box and fallback

This is genuinely new tooling under a fixed deadline. If Rust/protobuf/Substreams setup itself
(not the logic) is still unresolved by **Friday 2026-09-12**, stop and fall back to Route A
(Subgraph MCP — compose the two existing subgraphs with the Subgraph MCP, natural-language access
to Arcaidia's live liquidity/settlement state) rather than risk the submission on unfamiliar
tooling. Route A is documented in `BOUNTY-REQUIREMENTS.md` and needs no new toolchain.

## Acceptance gate

Mapped directly to the P1 prize text:
- [ ] A published, generic Substreams package on the Registry — usable by any ERC-4626 vault on
      Ethereum with zero Arcaidia-specific configuration (§2's bar, self-certified before publish).
- [ ] At least one Graph product composed with it (the substreams-powered subgraph, §5.5) —
      "querying one subgraph" alone does not qualify, per the prize text itself.
- [ ] A short, honest statement of what became easier because of the standardized schema —
      not marketing copy, a real before/after.
- [ ] Landed and demonstrable before 2026-09-13 12:00pm EDT, or the §7 fallback was taken instead.
