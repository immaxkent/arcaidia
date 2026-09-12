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
    expect(config).toEqual({
      port: 9090,
      heartbeatTimeoutSeconds: 60,
      heartbeatSweepIntervalMs: 1_000,
      vaultFlows: null,
      intelligence: {
        sources: [
          { chainId: 11_155_111, endpoint: 'https://hackathon.89.167.109.4.sslip.io/arcaidia-sepolia' },
          { chainId: 5_042_002, endpoint: 'https://hackathon.89.167.109.4.sslip.io/arcaidia-arc' },
        ],
      },
    });
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

  it('defaults vaultFlows to null — 501, not a silently-fabricated live feed (WP-21)', () => {
    expect(loadRelayConfig({}).vaultFlows).toBeNull();
  });

  it('wires vaultFlows when both VAULT_FLOWS_* variables are set', () => {
    const config = loadRelayConfig({
      VAULT_FLOWS_NEST_ENDPOINT: 'https://nest.example/arcaidia-sepolia',
      VAULT_FLOWS_FIXTURE_PATH: './fixture.json',
    });
    expect(config.vaultFlows).toEqual({
      nestEndpoint: 'https://nest.example/arcaidia-sepolia',
      fixturePath: './fixture.json',
    });
  });

  it('rejects VAULT_FLOWS_NEST_ENDPOINT set without VAULT_FLOWS_FIXTURE_PATH', () => {
    expect(() => loadRelayConfig({ VAULT_FLOWS_NEST_ENDPOINT: 'https://nest.example/x' })).toThrow(ConfigError);
  });

  it('rejects VAULT_FLOWS_FIXTURE_PATH set without VAULT_FLOWS_NEST_ENDPOINT', () => {
    expect(() => loadRelayConfig({ VAULT_FLOWS_FIXTURE_PATH: './fixture.json' })).toThrow(ConfigError);
  });
});

describe('loadRelayConfig — intelligence (WP-33)', () => {
  it('is on by default, reading the committed Nest endpoints', () => {
    expect(loadRelayConfig({}).intelligence).toEqual({
      sources: [
        { chainId: 11_155_111, endpoint: 'https://hackathon.89.167.109.4.sslip.io/arcaidia-sepolia' },
        { chainId: 5_042_002, endpoint: 'https://hackathon.89.167.109.4.sslip.io/arcaidia-arc' },
      ],
    });
  });

  it('honours a per-chain SUBGRAPH_URL override and INTELLIGENCE_ENABLED=false', () => {
    expect(loadRelayConfig({ SUBGRAPH_URL_ARC_TESTNET: 'https://my.nest/arc' }).intelligence?.sources[1]).toEqual({
      chainId: 5_042_002,
      endpoint: 'https://my.nest/arc',
    });
    expect(loadRelayConfig({ INTELLIGENCE_ENABLED: 'false' }).intelligence).toBeNull();
  });
});
