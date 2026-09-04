# Working agreement for Arcaidia

Read [`docs/Arcaidia_ETHOnline2026_Specification_v4.pdf`](docs/Arcaidia_ETHOnline2026_Specification_v4.pdf)
(or the text extraction beside it) before changing architecture. Work through
[`work-packages/`](work-packages/README.md) in order; a work package is done when its **acceptance
gate** is evidenced by passing tests, not when the code looks finished.

## Rules that override convenience

1. **Direction is configuration.** `processIntent(intent)` — never `processEthToArc()`. The same
   Solidity deploys to Ethereum and Arc. No chain name in a type, class or file name.
2. **Two settlement states.** `FAST_FILLED` and `SETTLED` are independent facts. A single
   "completed" boolean is a bug, in the contracts, the API and the UI.
3. **The Graph is observation, never authorization.** LP funds move only after independent RPC
   verification of the source receipt.
4. **Capital-safety decisions are deterministic and unit-tested.** An LLM may narrate a decision
   downstream of the verdict. It may never be the gate.
5. **Sponsor services live behind adapters** — `ObservationProvider`, `AgentSigner`,
   `SettlementAdapter`. Each has a local implementation and a sponsor implementation. Substituting
   one must not change core logic; if it does, the interface is wrong — fix the interface.
6. **Asset selection is configuration.** MockUSDC and real USDC share one code path. No
   `useRealUSDC` boolean, ever.
7. **CREATE2 same-address deployment** across both chains is an acceptance criterion. Identical
   init code; chain-specific values applied in `initialize`, never as constructor arguments.
8. **Both directions in every test.** Parameterise by config; never duplicate a test file per direction.
9. **Verify SDK and chain facts against current official documentation** before writing them into
   code. Circle, Privy, The Graph and Arc details change; do not code from memory or from an
   assumption recorded in `OPEN-QUESTIONS.md`.
10. **Commit frequently and chronologically.** Judges review history manually. Push after each
    green sub-task; never batch the work into one large final commit.

## Scope

V1 only, until V1 is frozen at WP-13. V2 (Uniswap) and V3 (Hedera/x402) are branch work after the
tag. Do not broaden scope until the V1 path is demonstrably reliable.
