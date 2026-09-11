import { describe, expect, it } from 'vitest';
import { ConfigError, loadRelayConfig } from '../../src/entrypoint/config.js';

describe('loadRelayConfig', () => {
  it('needs nothing set — no custody, no signer, nothing here is a secret (WP-18.5)', () => {
    expect(() => loadRelayConfig({})).not.toThrow();
  });

  it('defaults to port 8090 and a 30s heartbeat timeout', () => {
    const config = loadRelayConfig({});
    expect(config.port).toBe(8090);
    expect(config.heartbeatTimeoutSeconds).toBe(30);
    expect(config.heartbeatSweepIntervalMs).toBe(5_000);
  });

  it('honours an explicit override of every knob', () => {
    const config = loadRelayConfig({
      RELAY_PORT: '9090',
      RELAY_HEARTBEAT_TIMEOUT_SECONDS: '60',
      RELAY_HEARTBEAT_SWEEP_INTERVAL_MS: '1000',
    });
    expect(config).toEqual({ port: 9090, heartbeatTimeoutSeconds: 60, heartbeatSweepIntervalMs: 1_000 });
  });

  it('fails loudly on a non-numeric override rather than silently falling back', () => {
    expect(() => loadRelayConfig({ RELAY_PORT: 'not-a-number' })).toThrow(ConfigError);
  });

  it('fails loudly on a zero or negative override', () => {
    expect(() => loadRelayConfig({ RELAY_HEARTBEAT_TIMEOUT_SECONDS: '0' })).toThrow(ConfigError);
    expect(() => loadRelayConfig({ RELAY_HEARTBEAT_TIMEOUT_SECONDS: '-5' })).toThrow(ConfigError);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadRelayConfig({ RELAY_PORT: '70000' })).toThrow(ConfigError);
  });

  it('treats an empty-string override the same as unset', () => {
    expect(loadRelayConfig({ RELAY_PORT: '' }).port).toBe(8090);
  });
});
