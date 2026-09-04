# WP-00 — Domain & repository contract (M0)

**Objective:** one shared, typed vocabulary that every other package imports. If two packages ever
define "what an intent is", this work package has failed.

**Depends on:** nothing. **Blocks:** everything.
**Stack:** TypeScript, Node.js, pnpm, Vitest.

## Sub-tasks

- [ ] **0.1 Monorepo scaffold.** pnpm workspace; `packages/domain`, `contracts`, `packages/agent`,
      `packages/settlement`, `subgraph`, `apps/web`, `tests/e2e`. Root `tsconfig` with project
      references, shared ESLint/Prettier, `.editorconfig`, `.gitignore`.
- [ ] **0.2 Repo hygiene.** Public GitHub repo created immediately (judges review history).
      `.env.example` with every variable named and commented, never a real secret.
      MIT/Apache licence. `AGENTS.md` restating the non-negotiable design rules from the README.
- [ ] **0.3 Core types** in `packages/domain/src/types.ts`:
      `Intent`, `FillAuthorization`, `AgentDecision`, `RiskPolicy`, `VaultState`,
      `SettlementReference`, `SettlementStatus`. Fast status and canonical status are **two
      separate enums** — encode that in the type system so a single "completed" boolean is
      impossible to write.
- [ ] **0.4 Chain & token config** in `src/config.ts`: a `ChainConfig` record keyed by chain ID
      holding RPC, router address, vault address, settlement receiver, `settlementAsset`, CCTP
      domain, confirmation threshold, explorer URL. Direction resolution helpers:
      `resolveRoute(sourceChainId, destinationChainId)` returning both endpoints. **No
      `ETH_TO_ARC` constants anywhere.**
- [ ] **0.5 Deterministic intent ID** in `src/intent-id.ts`: pure function over the immutable
      intent fields (sender, recipient, token, amount, source chain, destination chain, nonce,
      deadline, maxFeeBps). Must produce the identical value as the Solidity implementation —
      this is the cross-language replay key.
- [ ] **0.6 EIP-712 schema** in `src/eip712.ts`: domain separator + `FillAuthorization` typed data
      (`intentId`, `sourceChainId`, `sourceTxHash`, `recipient`, `inputAmount`, `outputAmount`,
      `feeAmount`, `expiry`, `nonce`). One definition, shared by signer, verifier and tests.
- [ ] **0.7 Error taxonomy.** Typed errors for every rejection reason the agent or vault can
      produce, so the UI and logs can render a cause rather than a stack trace.
- [ ] **0.8 ABI export barrel** (`src/abis.ts`) — populated by WP-01's build output, stubbed now.
- [x] **0.9a ETHOnline submission entry created** — registered, accepted as a hacker, and the
      Arcaidia project exists in the dashboard (2026-09-04). Keep its description current as the
      build progresses rather than rewriting it at the end.
- [x] **0.9b Sponsor bounty listings read** and mapped to evidence and work packages in
      [BOUNTY-REQUIREMENTS.md](BOUNTY-REQUIREMENTS.md) (2026-09-04). Two gaps found: The Graph P1
      needs product composition we had not planned, and Arc P4 wants mainnet readiness by
      2026-09-30.

## Tests (Vitest)

- `intent-id` is deterministic, order-independent for named fields, and changes when any
  immutable field changes.
- EIP-712 typed-data hashing matches a known fixture (later cross-checked against Solidity).
- `resolveRoute` is symmetric: swapping source/destination yields the mirrored endpoints.
- Config validation rejects a partially-configured chain (missing CCTP domain, zero address).

## Acceptance gate

All downstream packages consume the same domain definitions; no duplicated intent/status schemas
anywhere in the repo. `pnpm -w test` green. Repo is public with at least a handful of real commits.

## Traps

- Writing status as `{ completed: boolean }` "just for now". It never gets un-done.
- Baking a direction into a type name. `SourceChain`/`DestinationChain` are *roles*, not chains.
- Letting `packages/domain` import viem chain-specific helpers — it must stay logic-free.
