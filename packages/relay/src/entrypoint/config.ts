/**
 * Config for the live Relay process.
 *
 * Deliberately small: WP-18.5's own gate is "no authority, ever" — this
 * process holds no vault custody, no signer, no RPC config, so there is
 * nothing here to keep secret. Everything is an optional tuning knob with a
 * sane default; nothing is required to start.
 */

import { CHAINS, type ChainKey } from '@arcaidia/domain';

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {}

export interface RelayEntrypointConfig {
  readonly port: number;
  /** No heartbeat within this window flips a vault to offline. */
  readonly heartbeatTimeoutSeconds: number;
  /** How often the sweep for timed-out heartbeats runs. */
  readonly heartbeatSweepIntervalMs: number;
  /**
   * WP-21. Both unset (the default) means `/v1/vault-flows/{vault}` reports
   * 501 rather than serving anything — there is no live Substreams
   * subscriber yet (see `vault-flows/fixture-source.ts`'s own doc comment),
   * so this stays off by default instead of silently degrading to always
   * returning the one committed fixture's data as if it were live.
   */
  readonly vaultFlows: null | {
    readonly nestEndpoint: string;
    readonly fixturePath: string;
  };
  /**
   * WP-33: the per-chain Nest endpoints the intelligence views are computed from. The committed
   * defaults from `@arcaidia/domain` apply; `SUBGRAPH_URL_{PREFIX}` overrides one, exactly as for
   * the solver and the worker. `INTELLIGENCE_ENABLED=false` turns the routes off (they answer 503).
   */
  readonly intelligence: null | { readonly sources: readonly { chainId: number; endpoint: string }[] };
}

const CHAIN_ENV_PREFIX: Record<ChainKey, string> = {
  'ethereum-sepolia': 'ETHEREUM_SEPOLIA',
  'arc-testnet': 'ARC_TESTNET',
};

function loadIntelligence(env: Env): RelayEntrypointConfig['intelligence'] {
  if (env['INTELLIGENCE_ENABLED'] === 'false') return null;
  const sources = (Object.keys(CHAINS) as ChainKey[]).map((key) => ({
    chainId: CHAINS[key].chainId,
    endpoint: env[`SUBGRAPH_URL_${CHAIN_ENV_PREFIX[key]}`] || CHAINS[key].subgraphUrl,
  }));
  return { sources };
}

function optionalPositiveInt(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${key} must be a positive integer if set; got ${JSON.stringify(raw)}.`);
  }
  return value;
}

export function loadRelayConfig(env: Env): RelayEntrypointConfig {
  const port = optionalPositiveInt(env, 'RELAY_PORT', 8090);
  if (port > 65_535) {
    throw new ConfigError(`RELAY_PORT must be a valid port number; got ${port}.`);
  }

  const nestEndpoint = env['VAULT_FLOWS_NEST_ENDPOINT'];
  const fixturePath = env['VAULT_FLOWS_FIXTURE_PATH'];
  if (Boolean(nestEndpoint) !== Boolean(fixturePath)) {
    throw new ConfigError(
      'VAULT_FLOWS_NEST_ENDPOINT and VAULT_FLOWS_FIXTURE_PATH must be set together, or neither at all.',
    );
  }

  return {
    port,
    heartbeatTimeoutSeconds: optionalPositiveInt(env, 'RELAY_HEARTBEAT_TIMEOUT_SECONDS', 30),
    heartbeatSweepIntervalMs: optionalPositiveInt(env, 'RELAY_HEARTBEAT_SWEEP_INTERVAL_MS', 5_000),
    vaultFlows: nestEndpoint && fixturePath ? { nestEndpoint, fixturePath } : null,
    intelligence: loadIntelligence(env),
  };
}
