/**
 * Config for the live Relay process.
 *
 * Deliberately small: WP-18.5's own gate is "no authority, ever" — this
 * process holds no vault custody, no signer, no RPC config, so there is
 * nothing here to keep secret. Everything is an optional tuning knob with a
 * sane default; nothing is required to start.
 */

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {}

export interface RelayEntrypointConfig {
  readonly port: number;
  /** No heartbeat within this window flips a vault to offline. */
  readonly heartbeatTimeoutSeconds: number;
  /** How often the sweep for timed-out heartbeats runs. */
  readonly heartbeatSweepIntervalMs: number;
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

  return {
    port,
    heartbeatTimeoutSeconds: optionalPositiveInt(env, 'RELAY_HEARTBEAT_TIMEOUT_SECONDS', 30),
    heartbeatSweepIntervalMs: optionalPositiveInt(env, 'RELAY_HEARTBEAT_SWEEP_INTERVAL_MS', 5_000),
  };
}
