# Open questions — resolve before they block

Each question names the work package that first depends on it. Answer it there or earlier.
Record the answer *in this file* with a date and a link to the source, so the README and the
demo script can cite it.

| # | Question | Blocks | Status |
| --- | --- | --- | --- |
| Q1 | Which Arc network is the target (testnet name, chain ID, RPC, explorer)? Is it EVM-equivalent for `CREATE2` and `PUSH0`? | WP-01 | OPEN |
| Q2 | Does Arc support CCTP, at which version (v1/v2), and what is its CCTP **domain ID**? Which `TokenMessenger` / `MessageTransmitter` addresses? | WP-01 (config), WP-10 (hard) | OPEN |
| Q3 | Canonical USDC address on each target network (Ethereum testnet + Arc). Is testnet USDC mintable via a Circle faucet? | WP-10 | OPEN |
| Q4 | Circle **Agent Wallet**: exact product/SDK name and current API surface. Can it produce a raw **EIP-712 signature**, or only *execute* transactions? This determines whether `FillAuthorization` is signed-then-relayed or executed directly by the wallet. | WP-09 (design impact reaches WP-05) | OPEN |
| Q5 | What policy controls does the Agent Wallet actually support (contract allowlist, per-tx cap, daily cap)? These are claimed as a control layer in the security model. | WP-09 | OPEN |
| Q6 | Does The Graph's hosted/decentralised network support indexing Arc? If not — Substreams, a self-hosted graph-node, or Graph's testnet path? | WP-08 | OPEN |
| Q7 | Do we need one subgraph per chain (near-certain) and a client-side merge, or is there a cross-chain composition path worth using? | WP-08 | OPEN |
| Q8 | Privy: embedded wallet vs external wallet for the demo; which chains can Privy be configured against, and can it sign for Arc? | WP-03 | OPEN |
| Q9 | Confirmation threshold policy for the demo (spec permits a low testnet threshold). Pick a number and justify it in the README. | WP-04 | OPEN |
| Q10 | Fee split between LP / solver / protocol for V1 accounting. Spec says "explicit but simple". | WP-02 | OPEN |
| Q11 | Bounty submission requirements per sponsor (Arc/Circle, The Graph, Privy) — read the actual ETHOnline listings and turn them into a checklist. | WP-12 (but read in WP-00) | OPEN |

## Verification discipline

Every SDK, chain and API detail above must be confirmed against **current official documentation**
before it is written into config or contracts. Do not code from memory or from this file's
assumptions. When an answer lands, replace the row's status with the answer, the date and the
source URL.
