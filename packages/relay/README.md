# @arcaidia/relay

The telemetry relay (WP-18) and, since WP-33, the ecosystem intelligence surface. One small
Node process, no database: telemetry state lives in memory, intelligence is computed on demand
from Arcaidia's shared Nest indexer and cached for ten seconds.

```
pnpm relay:start            # RELAY_PORT (default 8090)
```

## Telemetry (WP-18)

| Method | Path | Who |
| --- | --- | --- |
| `POST` | `/v1/telemetry/pair/challenge`, `/v1/telemetry/pair` | a solver proving it holds a vault's authorised signer |
| `POST` | `/v1/telemetry/heartbeat`, `/v1/telemetry/events` | that solver, every 10 s / per pre-chain stage |
| `GET` | `/v1/telemetry/vault/{chainId}/{vault}/stream` | the site (server-sent events) |

## Ecosystem intelligence (WP-33)

Read-only, CORS-open, unauthenticated. Every figure is computed from the Nest's `vaults`,
`intents`, `fills` and `settlements` views for both chains, over a trailing one-hour window,
and is either real or `null` — a Nest that cannot answer is a `503` with the reason, never a
zero. Bigints are decimal strings on the wire.

| Path | Returns |
| --- | --- |
| `GET /v1/intelligence/ecosystem` | `EcosystemIntelligence` (`@arcaidia/domain`): aggregate available liquidity and utilisation, per-vault fees with min/median/max, outstanding intent volume, pending CCTP exposure, fill velocity, settlement latency p50/p95, liquidity concentration (HHI), largest fillable size, scarcity score, source blocks |
| `GET /v1/intelligence/chain/{chainId}` | the same, scoped to one destination chain |
| `GET /v1/intelligence/vault/{chainId}/{vault}` | one vault: fee, utilisation, available liquidity, fill capacity, share of its chain, fee rank |
| `GET /v1/intelligence/quote-context?amount=<units>&destinationChainId=<id>` | how many vaults could fill this size now, the best and the range of their fees, scarcity |

Definitions live in `src/intelligence/compute.ts` and are the same arithmetic the vault
contract runs (available = liquid − reserve floor; a fill is capped by `maxFillBps` of available
and by exposure headroom under `maxExposureBps`).

Config: on by default, reading the committed per-chain Nest URLs from `@arcaidia/domain`;
`SUBGRAPH_URL_ETHEREUM_SEPOLIA` / `SUBGRAPH_URL_ARC_TESTNET` override one; `INTELLIGENCE_ENABLED=false`
turns the routes off (they answer `503`).

Consumers: the site's Liquidity page (`useMarketIntelligence`), the reference solver's optional
`HttpIntelligenceProvider` (`INTELLIGENCE_URL`; narrative only, never a verdict input), and the
MCP server's `ecosystem_intelligence` tool.

### x402 readiness (for WP-35, the Hedera-paid gateway)

The intelligence endpoints are built to sit behind a paying proxy without changing:

- **Stateless and idempotent.** `GET` only, no session, no cookies, no per-caller state; the
  same URL returns the same picture to everyone within the cache window.
- **Versioned.** Everything is under `/v1/`; a breaking change is `/v2/`, never a silent reshape.
- **Self-describing errors.** Non-200 responses carry `{ "error": "<reason>" }`, so a gateway can
  pass them through verbatim.
- **No secrets in the response path.** Nothing the gateway would need to strip or inject.

A WP-35 gateway therefore proxies `/v1/intelligence/*`, answers an unpaid request with `402` and
the x402 payment-required header (Hedera payment details), verifies the payment, and forwards a
paid request upstream, returning the upstream body verbatim plus a receipt. The relay itself
never learns about payment.
