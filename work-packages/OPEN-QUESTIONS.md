# Open questions — resolve before they block

Each question names the work package that first depends on it. Answers are
recorded here with their date and source, so the README and the demo script can
cite them.

| # | Question | Blocks | Status |
| --- | --- | --- | --- |
| Q1 | Target Arc network, chain ID, RPC, explorer, EVM equivalence | WP-01 | **ANSWERED 2026-09-04** |
| Q2 | Arc CCTP support, version, domain ID, contract addresses | WP-01, WP-10 | **ANSWERED 2026-09-04** |
| Q3 | Canonical USDC address per network; testnet faucet | WP-10 | **ANSWERED 2026-09-04** |
| Q4 | Circle Agent Wallet: raw EIP-712 signature or execute-only? | WP-09 (reaches WP-05) | **ANSWERED 2026-09-04**, one residual (EOA vs SCA) |
| Q5 | Agent Wallet policy controls | WP-09 | **ANSWERED 2026-09-04** |
| Q6 | Can The Graph index Arc? | WP-08 | **ANSWERED 2026-09-04**, one residual (Studio vs network) |
| Q7 | One subgraph per chain, or cross-chain composition? | WP-08 | **ANSWERED 2026-09-04** |
| Q8 | Privy wallet model; can it sign for Arc? | WP-03 | **ANSWERED 2026-09-05** |
| Q9 | Confirmation threshold policy for the demo | WP-04 | OPEN — informed by Q2's finality finding |
| Q10 | Fee split between LP / solver / protocol | WP-02 | OPEN |
| Q11 | Per-sponsor bounty requirements → evidence checklist | WP-12 | **ANSWERED 2026-09-04** — see [BOUNTY-REQUIREMENTS.md](BOUNTY-REQUIREMENTS.md) |

---

## Q1 — Arc network parameters (ANSWERED)

**Target: Arc Testnet.** Arc mainnet is not live as of 2026-09-04; public launch
is announced for 2026-09-16. Circle's CCTP documentation lists **Arc testnet
only** — no Arc mainnet CCTP deployment exists yet. See the contradiction note in
[WP-00-REPORT.md](WP-00-REPORT.md).

| Parameter | Value |
| --- | --- |
| Chain ID | `5042002` (verified live: `eth_chainId` → `0x4cef52`) |
| RPC | `https://rpc.testnet.arc.io` (also Blockdaemon, dRPC, QuickNode endpoints) |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| Gas token | **USDC**, 18 decimals for gas accounting |
| Consensus | Malachite, sub-500ms finality, Reth execution layer |

**EVM equivalence:** Arc supports `CREATE2` with identical behaviour to Ethereum,
including EIP-7610 residual-storage mechanics, and `PUSH0` per Ethereum's Osaka
baseline. Divergences that do not affect us: `PREVRANDAO` always returns 0,
`BLOBHASH`/`BLOBBASEFEE` return 0/1, `parentBeaconBlockRoot` returns the parent
execution block hash.

**CREATE2 parity is achievable.** Arachnid's deterministic deployment proxy is
live at `0x4e59b44847b379578588920cA78FbF26c0B4956C` on **both** Arc testnet and
Ethereum Sepolia — verified by `eth_getCode` returning identical bytecode on each.

Sources: [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc),
[EVM differences](https://docs.arc.io/arc/references/evm-differences)

## Q2 — CCTP support and domains (ANSWERED)

CCTP **V2** on both chains. Domain IDs are Circle-issued and unrelated to EVM chain IDs.

| Chain | CCTP domain | Transfer types supported |
| --- | --- | --- |
| Ethereum (mainnet + Sepolia) | **0** | Standard, **Fast**, upfront fees, forwarding |
| Arc testnet | **26** | Standard, upfront fees, forwarding — **Fast Transfer not listed** |

**CCTP V2 contracts are at identical addresses on Ethereum Sepolia and Arc testnet**
(all verified present via `eth_getCode` on both chains):

| Contract | Address (both chains, testnet) |
| --- | --- |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` |
| MessageV2 | `0xbaC0179bB358A8936169a63408C8481D582390C4` |

Ethereum **mainnet** CCTP V2 addresses differ (`TokenMessengerV2`
`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`, `MessageTransmitterV2`
`0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`); recorded for a future mainnet move.

**Attestation:** Iris API. Testnet base URL `https://iris-api-sandbox.circle.com`.
`GET /v2/messages/{domain}?transactionHash={hash}` retrieves messages and
attestations by source transaction or nonce. Rate limit 40 req/s. Finality
thresholds: Fast Transfer = 1000 ("confirmed"), Standard = 2000 ("finalized").

**Bidirectional availability:** Circle publishes a quickstart for Ethereum Sepolia
→ Arc testnet. It does **not** document the reverse. Both chains have the full
CCTP V2 contract set deployed, so Arc → Ethereum should work symmetrically, but
this is an inference and must be proven empirically in WP-10 before it is claimed.

Sources: [Supported chains and domains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains),
[Contract addresses](https://developers.circle.com/cctp/references/contract-addresses),
[Ethereum→Arc quickstart](https://developers.circle.com/cctp/quickstarts/transfer-usdc-ethereum-to-arc),
[CCTP technical guide](https://developers.circle.com/cctp/technical-guide)

## Q3 — USDC addresses (ANSWERED)

| Chain | USDC | Notes |
| --- | --- | --- |
| Ethereum Sepolia | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | Ordinary ERC-20, 6 decimals |
| Arc testnet | `0x3600000000000000000000000000000000000000` | **ERC-20 facade over the native gas token**, 6 decimals |

Verified live on Arc: `decimals()` → `6`, `symbol()` → `"USDC"`, contract code present.

**Consequence for the protocol:** on Arc, USDC is simultaneously the gas token and
the settlement asset. The LiquidityVault's inventory and its gas are the same
asset. This does not change the protocol's IERC20-facing logic, but WP-01 must
confirm the facade implements full `approve`/`transferFrom` semantics, and WP-02
must not assume vault balance and gas balance are independent.

Faucet: `https://faucet.circle.com`.

Sources: [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses),
[USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)

## Q4 — Circle Agent Wallet authorization model (ANSWERED, one residual)

**Agent Wallets can sign EIP-712 typed data and return a raw signature.** The
`sign` shape in the specification is viable; we are not forced into an
execute-only design.

- Agent Stack exposes `circle wallet sign typed-data '<EIP-712 JSON>' --address <addr> --chain <CHAIN>`,
  returning a signature (`0xabcdef1234…`). Typed-data signing is EVM-only.
- The equivalent REST endpoint for developer-controlled wallets is
  `POST /v1/w3s/developer/sign/typedData` (requires `entitySecretCiphertext`).
- Circle Wallets support **`ARC-TESTNET`** as a first-class blockchain, with its
  own chain code — an EVM-TESTNET wallet is not required.
- Agent Wallets are built on Circle's user-controlled wallets with 2-of-2 MPC key
  management; key shares are never exposed to the agent.

**Recommendation: the vault should authenticate a recovered EIP-712 signer**
(`ecrecover` against an allowlist), not `msg.sender`. It keeps the authorization
portable, lets any relayer submit, keeps the local signer and the Circle signer
behind one interface, and matches the specification as written.

**Residual, must be settled before WP-05 finishes:** provision the agent wallet as
an **EOA**, not a Smart Contract Account. Circle supports both. An SCA signature
requires EIP-1271 verification rather than `ecrecover`, and SCA wallets use lazy
deployment — signing before first deployment fails. `packages/domain/src/ports.ts`
therefore keeps both a `SigningAuthority` and an `ExecutingAuthority` shape and is
marked provisional. Confirm the account type onchain, then narrow it.

Sources: [Agent wallets](https://developers.circle.com/agent-stack/agent-wallets),
[Sign a message (Agent Stack)](https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/sign),
[Sign typed data API](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/sign-typed-data),
[How signing APIs work](https://developers.circle.com/wallets/signing-apis),
[Supported blockchains](https://developers.circle.com/w3s/supported-blockchains-and-currencies)

## Q5 — Agent Wallet policy controls (ANSWERED)

Supported spending policies, which give us the second control layer the security
model claims:

- USDC spending limits on outbound transfers and x402 payments, **time-bound**
  (daily, monthly).
- **Allowlists and blocklists** for both wallet addresses and contract addresses.
- Sanctions screening on all transfers before onchain submission.

This maps cleanly onto the specification's requirement: wallet policy (contract
allowlist + per-transaction and daily value caps) **plus** the vault's own onchain
caps, as two independent layers.

Source: [Agent wallets](https://developers.circle.com/agent-stack/agent-wallets)

## Q6 / Q7 — The Graph on both chains (ANSWERED, one residual)

**The Graph supports Arc.** Dedicated network pages exist for both Arc Mainnet and
Arc Testnet. Arc Testnet's registry entry:

| Field | Value |
| --- | --- |
| Identifier (use in `subgraph.yaml`) | `arc-testnet` |
| Protocol | `ethereum` |
| Chain ID | `eip155:5042002` |
| Type | testnet |

Ethereum Sepolia is `sepolia`. **No Substreams and no self-hosted graph-node is
required** — the simplest qualifying architecture is available.

**Q7 architecture:** two subgraphs, one per chain, joined client-side on
`intentId` by `GraphObservationProvider`. Standard practice; The Graph has no
cross-chain composition primitive that would simplify this. Each chain's indexing
lag must be tracked independently and exposed to the risk engine as staleness —
already modelled as `DecisionInputs.observationAgeSeconds`.

**Residual for WP-08:** confirm whether `arc-testnet` is served by Subgraph Studio,
the decentralised network, or both, and check the feature-support matrix. This
affects the deployment command, not the architecture.

Sources: [Arc Testnet](https://thegraph.com/docs/en/supported-networks/arc-testnet/),
[Supported networks](https://thegraph.com/docs/en/supported-networks/)

## Settlement observability for the risk engine (investigated)

The four signals the risk engine needs are all derivable without any
Circle-specific type reaching the domain model:

| Signal | Derivation |
| --- | --- |
| `oldestUnsettledIntent` | Max age over intents where `fastStatus = FAST_FILLED` and `canonicalStatus = PENDING`. Sourced from The Graph; cross-checked onchain. |
| `pendingCCTPValue` | Sum of `inputAmount` over the same set. Also readable as the vault's `outstandingExposure`. |
| `averageSettlementLatency` | Rolling mean of `settledAt − createdAt` over recent settlements, from indexed events. |
| `vaultLiquidity` | `totalBalance − reserveFloor` read from the vault contract; `availableLiquidity()` in the domain package. |
| Transport health | Iris reachability plus whether `GET /v2/messages` statuses are advancing. |

Modelled as `SettlementHealth` in `packages/domain/src/types/settlement.ts`, with
`transport: HEALTHY | DEGRADED | UNAVAILABLE`. `CircleCCTPAdapter` maps Iris
responses onto it in WP-10; no Iris response object is referenced anywhere above
the adapter boundary.

**Residual for WP-10:** the exact Iris response status field names are not in the
technical-guide page. Read the API reference when building the adapter.

## Q8 — Privy on Arc (ANSWERED)

**Decision: embedded wallets.** Privy generates and custodies the key; the user signs in with
email or social. Better demo, and it exercises the part of Privy their bounty is about.

**Arc is supported, and needs no special handling.** Privy's own documentation states that
*"Privy embedded wallets can support any EVM-compatible chain"*. A chain absent from
`viem/chains` is declared with viem's `defineChain` and passed to `PrivyProvider`'s
`supportedChains`. There is no dashboard allowlist, no official-chains restriction, and no
difference between embedded and external wallets in this respect.

```ts
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
});
```

**Why the USDC gas token is not a problem.** On Arc, USDC is the *native* token at the protocol
level — not an ERC-20 gas abstraction or a paymaster. `msg.value`, `balance` and gas accounting
all behave as they would with ETH; only the ticker and the 18-decimal gas accounting differ, and
`defineChain`'s `nativeCurrency` field carries exactly those. This is why Arc's own documentation
lists MetaMask, Rabby, Coinbase Wallet and Rainbow as working with manual network configuration:
Arc is an ordinary EVM chain to a wallet. Privy reaches it by the same mechanism.

Note the guardrail in Privy's docs: *"attempting to send a transaction on or switch the wallet to
a network not in the list of supported chains will throw an error."* Both chains must be in
`supportedChains` or the bidirectional flow breaks — worth a test in WP-03.

**Residual, only checkable with a live app id:** whether any Privy UI surface assumes an ETH-named
gas token when presenting a transaction for approval. A cosmetic risk rather than a functional one,
since the signing path is chain-agnostic. Confirm on the first real Arc transaction in WP-03.

Sources: [Configuring EVM networks](https://docs.privy.io/basics/react/advanced/configuring-evm-networks),
[Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc)
