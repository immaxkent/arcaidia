import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerDeployment, resetDeployments } from '@arcaidia/domain';
import { ConfigError, loadSettlementConfig } from '../../src/entrypoint/config.js';

const REPORTER_KEY = `0x${'33'.repeat(32)}` as const;

const RECEIVER_SEPOLIA = '0x1111111111111111111111111111111111111111';
const RECEIVER_ARC = '0x2222222222222222222222222222222222222222';

function baseEnv(): Record<string, string> {
  return {
    LOCAL_REPORTER_PRIVATE_KEY: REPORTER_KEY,
    CIRCLE_IRIS_BASE_URL: 'https://iris-api-sandbox.circle.com',
    SUBGRAPH_URL_ETHEREUM_SEPOLIA: 'https://api.studio.thegraph.com/query/sepolia',
    SUBGRAPH_URL_ARC_TESTNET: 'https://api.studio.thegraph.com/query/arc',
  };
}

describe('loadSettlementConfig', () => {
  beforeEach(() => {
    registerDeployment('ethereum-sepolia', { settlementReceiver: RECEIVER_SEPOLIA });
    registerDeployment('arc-testnet', { settlementReceiver: RECEIVER_ARC });
  });

  afterEach(() => resetDeployments());

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('builds a full config from a complete environment', () => {
    const config = loadSettlementConfig(baseEnv());

    expect(config.reporterPrivateKey).toBe(REPORTER_KEY);
    expect(config.irisBaseUrl).toBe('https://iris-api-sandbox.circle.com');
    expect(config.pollIntervalMs).toBe(15_000);
    expect(config.chains).toHaveLength(2);

    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    expect(sepolia).toMatchObject({
      settlementReceiver: RECEIVER_SEPOLIA,
      subgraphUrl: 'https://api.studio.thegraph.com/query/sepolia',
      domain: 0,
    });
  });

  it('reads the CCTP domain and MessageTransmitter address from the committed chain config', () => {
    const config = loadSettlementConfig(baseEnv());

    const arc = config.chains.find((c) => c.chainId === 5_042_002);
    expect(arc?.domain).toBe(26);
    expect(arc?.messageTransmitter).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('honours an RPC URL override without needing one', () => {
    const config = loadSettlementConfig({ ...baseEnv(), ETHEREUM_SEPOLIA_RPC_URL: 'http://localhost:9999' });
    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    expect(sepolia?.rpcUrl).toBe('http://localhost:9999');
  });

  it('falls back to the domain package default RPC when no override is set', () => {
    const config = loadSettlementConfig(baseEnv());
    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    expect(sepolia?.rpcUrl).toMatch(/^https?:\/\//);
  });

  it('honours a poll interval override', () => {
    const config = loadSettlementConfig({ ...baseEnv(), SETTLEMENT_POLL_INTERVAL_MS: '5000' });
    expect(config.pollIntervalMs).toBe(5_000);
  });

  // -----------------------------------------------------------------------
  // Sad paths
  // -----------------------------------------------------------------------

  it('refuses a missing reporter key', () => {
    const env = baseEnv();
    delete (env as Partial<typeof env>).LOCAL_REPORTER_PRIVATE_KEY;
    expect(() => loadSettlementConfig(env)).toThrow(ConfigError);
    expect(() => loadSettlementConfig(env)).toThrow(/LOCAL_REPORTER_PRIVATE_KEY/);
  });

  it('refuses a reporter key that is not 0x-prefixed hex', () => {
    expect(() => loadSettlementConfig({ ...baseEnv(), LOCAL_REPORTER_PRIVATE_KEY: 'not-hex' })).toThrow(
      ConfigError,
    );
  });

  it('refuses a missing Iris base URL', () => {
    const env = baseEnv();
    delete (env as Partial<typeof env>).CIRCLE_IRIS_BASE_URL;
    expect(() => loadSettlementConfig(env)).toThrow(/CIRCLE_IRIS_BASE_URL/);
  });

  it('refuses a missing subgraph URL — never silently falls back to a local view', () => {
    const env = baseEnv();
    delete (env as Partial<typeof env>).SUBGRAPH_URL_ETHEREUM_SEPOLIA;
    expect(() => loadSettlementConfig(env)).toThrow(/SUBGRAPH_URL_ETHEREUM_SEPOLIA/);
  });

  it('refuses a missing subgraph URL for the other chain too', () => {
    const env = baseEnv();
    delete (env as Partial<typeof env>).SUBGRAPH_URL_ARC_TESTNET;
    expect(() => loadSettlementConfig(env)).toThrow(/SUBGRAPH_URL_ARC_TESTNET/);
  });

  it('refuses a chain with no deployed SettlementReceiver', () => {
    resetDeployments();
    registerDeployment('ethereum-sepolia', {});
    registerDeployment('arc-testnet', { settlementReceiver: RECEIVER_ARC });
    expect(() => loadSettlementConfig(baseEnv())).toThrow(ConfigError);
  });

  it('refuses a zero or negative poll interval', () => {
    expect(() => loadSettlementConfig({ ...baseEnv(), SETTLEMENT_POLL_INTERVAL_MS: '0' })).toThrow(ConfigError);
    expect(() => loadSettlementConfig({ ...baseEnv(), SETTLEMENT_POLL_INTERVAL_MS: '-5' })).toThrow(
      ConfigError,
    );
  });

  it('refuses a non-numeric poll interval', () => {
    expect(() => loadSettlementConfig({ ...baseEnv(), SETTLEMENT_POLL_INTERVAL_MS: 'soon' })).toThrow(
      ConfigError,
    );
  });
});
