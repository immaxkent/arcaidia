# WP-09 — Circle Agent Wallet (M9)

**Objective:** the agent's bounded machine identity. Replace `LocalAgentSigner` with a real Circle
Agent Wallet, without touching core agent logic.

**Depends on:** WP-07 (WP-08 preferably green too). **Blocks:** WP-11.
**Stack:** Circle Agent Stack / Agent Wallet SDK, TypeScript.

## Sub-tasks

- [x] **9.1 Resolve Q4 against current Circle documentation** — answered in `OPEN-QUESTIONS.md`
      Q4/Q5 and recorded in the README (§"V1 uses an authorised solver model"): the wallet returns
      a **raw EIP-712 signature** via `POST /v1/w3s/developer/sign/typedData`; the vault authorises
      a recovered signer, not `msg.sender`. Account type is **EOA** (the doc's residual — SCA would
      need EIP-1271, not `ecrecover`).
- [x] **9.2 Provision the wallet.** `packages/agent/scripts/setup-circle-agent-wallet.ts` generates
      + registers the entity secret and creates an EOA wallet on `ARC-TESTNET` via Circle's
      Developer-Controlled Wallets API — run once, live, this session:
      address `0x6b73143220c1fb00b96d7dbde302ff55157f3424` — granted as an authorised solver
      signer via `AuthorizeSolverSigner.s.sol` on **both** chains, 2026-09-10.
- [x] **9.3 `CircleAgentWalletSigner`** (`packages/agent/src/signing/circle-agent-wallet-signer.ts`)
      implementing `AgentAuthority` exactly — `processIntent` and everything upstream is unchanged.
      Selected over `LocalAgentSigner` in `build-dependencies.ts` by `SolverEntrypointConfig.signerAuthority.mode`,
      itself chosen in `config.ts` by whether all four `CIRCLE_*` env vars are set (partial config
      is a hard `ConfigError`, never a silent fallback to local). **Live-verified**: signed a real
      `FillAuthorization` through Circle's sandbox API; the recovered address matched the wallet's
      own address exactly, confirming the EOA/`ecrecover` path the vault expects actually works —
      not just that the SDK call succeeds.
- [ ] **9.4 Wallet policies** (Q5): contract allowlist, asset allowlist, per-transaction cap,
      daily cap. **Not started, and genuinely blocked on testnet**: Circle's own CLI (`circle
      wallet limit set`, the only documented way to set these — no console UI, no plain REST
      endpoint) refuses with `"Spending policies are mainnet-only"` on any testnet chain,
      including the allowlist/blocklist rule types (same command, same gate). Our wallet is
      `ARC-TESTNET`. This isn't a "not built yet" gap, it's a "cannot exist yet" one — see the
      Traps section for the options.
- [x] **9.5 Operational hardening (signing path only).** `CircleAgentWalletSigner` throws
      `CircleSigningError` on a missing or malformed signature rather than passing it through, and
      propagates the client's own errors (API failure, rate limit) rather than swallowing them —
      `processIntent`'s existing error handling means a signing failure here surfaces the same way
      a `LocalAgentSigner` failure would, no half-executed fill. Rate-limit backoff and key rotation
      specifically: not built, no evidence either is needed yet at hackathon-demo call volume.
- [ ] **9.6 Evidence for the demo.** Not started — needs 9.2's onchain grant plus a real fill
      through the live solver using this wallet (folds into WP-11.1, the qualifying run).

## Tests

- `packages/agent/test/circle-agent-wallet-signer.test.ts` (7 tests): signs through an injected
  fake client and recovers to the wallet's own address (signer parity with `LocalAgentSigner`,
  proven against a real ECDSA recovery, not just a mock equality check); rejects a missing,
  malformed, or truncated signature; propagates a client/network error rather than swallowing it.
- `packages/agent/test/entrypoint/config.test.ts`: selects the Circle authority only when all four
  `CIRCLE_*` vars are set; refuses a partial Circle config with each single var missing in turn;
  refuses a non-hex wallet address; does not require `LOCAL_AGENT_PRIVATE_KEY` in Circle mode.
- `packages/agent/test/entrypoint/build-dependencies.test.ts`: wires a `CircleAgentWalletSigner`
  keyed to the configured address when `signerAuthority.mode === 'circle'`.
- Wallet **policy** enforcement (9.4) has no tests yet — nothing to test until the policies exist.

263 agent tests total (was 256 pre-WP-09), typecheck clean across the monorepo.

## Acceptance gate

**Partially met.** The signing mechanism is real, live-verified end to end through Circle's actual
API, and produces a signature the vault's `ecrecover` will accept. The wallet is now onchain-
authorised on **both** chains (`AuthorizeSolverSigner.s.sol`, run 2026-09-10). **Not yet met**:
wallet policies (9.4) are blocked on testnet (see above), and no actual fill has been executed by
this authority (9.6) — that last piece is WP-11.1's job, not a separate effort.

## Traps

- Discovering the sign-vs-execute distinction here rather than in WP-05. Answer Q4 early.
- Letting Circle SDK types leak into the risk engine. The adapter boundary is the whole point.
- Keeping only wallet policy or only vault caps. The claim is two independent layers — build both.
- **Found live, not obvious from the SDK's types**: `fillAuthorizationTypedData` (the shared
  domain-package helper, correct for viem's own `signTypedData`) omits an explicit `EIP712Domain`
  entry in `types` — viem derives it implicitly from the `domain` object. Circle's remote API
  parses the JSON directly and rejects it without that entry (`error 156026: "extra data provided
  in the message... Failed during the validation for typed data"`). Fixed at the wire boundary only
  (`CircleAgentWalletSigner`'s own JSON serialisation adds `EIP712Domain` before sending), not in
  the shared helper — viem's contract for every other caller stays unchanged.
- `SOLVER_SIGNER_ADDRESS` for `AuthorizeSolverSigner.s.sol` reuses the existing script/allowlist —
  the Circle wallet is just another address to grant, not a new authorization mechanism.
- **Wallet policies are a mainnet-only product feature**, not a permissions or setup gap: Circle's
  `circle wallet limit set` (the only documented way to set per-tx/daily caps and
  allowlist/blocklist rules — no console UI, no plain REST endpoint found) returns
  `"Spending policies are mainnet-only"` on any testnet chain. Three honest options once Arc
  mainnet is live (2026-09-16): (a) set real policies against the mainnet wallet and demonstrate
  them there, folding into the P4 mainnet-readiness story; (b) state the limitation plainly in the
  submission — "the vault's own onchain caps are the enforced control on testnet; wallet policies
  are Circle's mainnet-only feature, verified against console documentation, not yet demonstrable
  pre-launch"; (c) skip 9.4 for the demo and rely on the vault's independent onchain caps as the
  one control layer that *is* live everywhere. Not decided — needs a call once WP-12 firms up the
  submission story.

## Cross-reference — reference solver runtime (post-V1)

`WP-INTENT-MARKET.md` §7 lists `SOLVER_KEY | Circle Agent Wallet config` as a single
configuration choice for the post-V1 permissionless solver runtime. That is exactly this work
package's swap — `AgentAuthority` already abstracts local key vs. Circle Agent Wallet, so
nothing here changes, and that later work needs no rework of it.
