import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerDeployment, resetDeployments } from '@arcaidia/domain';
import { ConfigError, loadSolverConfig } from '../../src/entrypoint/config.js';

const SIGNER_KEY = `0x${'11'.repeat(32)}` as const;
const SUBMITTER_KEY = `0x${'22'.repeat(32)}` as const;

const ROUTER_SEPOLIA = '0x1111111111111111111111111111111111111111';
const VAULT_SEPOLIA = '0x2222222222222222222222222222222222222222';
const ROUTER_ARC = '0x3333333333333333333333333333333333333333';
const VAULT_ARC = '0x4444444444444444444444444444444444444444';

function baseEnv(): Record<string, string> {
  return {
    LOCAL_AGENT_PRIVATE_KEY: SIGNER_KEY,
    LOCAL_SUBMITTER_PRIVATE_KEY: SUBMITTER_KEY,
    SUBGRAPH_URL_ETHEREUM_SEPOLIA: 'https://api.studio.thegraph.com/query/sepolia',
    SUBGRAPH_URL_ARC_TESTNET: 'https://api.studio.thegraph.com/query/arc',
  };
}

describe('loadSolverConfig', () => {
  beforeEach(() => {
    registerDeployment('ethereum-sepolia', { intentRouter: ROUTER_SEPOLIA, liquidityVault: VAULT_SEPOLIA });
    registerDeployment('arc-testnet', { intentRouter: ROUTER_ARC, liquidityVault: VAULT_ARC });
  });

  afterEach(() => resetDeployments());

  it('happy path: builds a full config from a complete environment', () => {
    const config = loadSolverConfig(baseEnv());

    expect(config.signerPrivateKey).toBe(SIGNER_KEY);
    expect(config.submitterPrivateKey).toBe(SUBMITTER_KEY);
    expect(config.pollIntervalMs).toBe(10_000);
    expect(config.authorizationTtlSeconds).toBe(45);
    expect(config.quotePort).toBe(8787);
    expect(config.chains).toHaveLength(2);

    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    expect(sepolia).toMatchObject({
      intentRouter: ROUTER_SEPOLIA,
      liquidityVault: VAULT_SEPOLIA,
      subgraphUrl: 'https://api.studio.thegraph.com/query/sepolia',
    });
  });

  it('honours an RPC URL override without needing one', () => {
    const config = loadSolverConfig({ ...baseEnv(), ETHEREUM_SEPOLIA_RPC_URL: 'http://localhost:9999' });
    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    expect(sepolia?.rpcUrl).toBe('http://localhost:9999');
  });

  it('falls back to the domain package default RPC when no override is set', () => {
    const config = loadSolverConfig(baseEnv());
    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    expect(sepolia?.rpcUrl).toMatch(/^https?:\/\//);
  });

  it('honours poll interval and TTL overrides', () => {
    const config = loadSolverConfig({
      ...baseEnv(),
      SOLVER_POLL_INTERVAL_MS: '2500',
      SOLVER_AUTHORIZATION_TTL_SECONDS: '30',
    });
    expect(config.pollIntervalMs).toBe(2_500);
    expect(config.authorizationTtlSeconds).toBe(30);
  });

  // --- Sad paths -------------------------------------------------------------

  it('refuses a missing signer key', () => {
    const env = baseEnv();
    delete (env as Partial<typeof env>).LOCAL_AGENT_PRIVATE_KEY;
    expect(() => loadSolverConfig(env)).toThrow(ConfigError);
    expect(() => loadSolverConfig(env)).toThrow(/LOCAL_AGENT_PRIVATE_KEY/);
  });

  it('refuses a missing submitter key', () => {
    const env = baseEnv();
    delete (env as Partial<typeof env>).LOCAL_SUBMITTER_PRIVATE_KEY;
    expect(() => loadSolverConfig(env)).toThrow(/LOCAL_SUBMITTER_PRIVATE_KEY/);
  });

  it('refuses a signer key that is not 0x-prefixed hex', () => {
    expect(() => loadSolverConfig({ ...baseEnv(), LOCAL_AGENT_PRIVATE_KEY: 'not-hex' })).toThrow(ConfigError);
  });

  it('refuses a missing subgraph URL — never silently falls back to a local view', () => {
    const env = baseEnv();
    delete (env as Partial<typeof env>).SUBGRAPH_URL_ETHEREUM_SEPOLIA;
    expect(() => loadSolverConfig(env)).toThrow(/SUBGRAPH_URL_ETHEREUM_SEPOLIA/);
  });

  it('refuses a missing subgraph URL for the other chain too', () => {
    const env = baseEnv();
    delete (env as Partial<typeof env>).SUBGRAPH_URL_ARC_TESTNET;
    expect(() => loadSolverConfig(env)).toThrow(/SUBGRAPH_URL_ARC_TESTNET/);
  });

  it('refuses a chain with no deployed contracts', () => {
    resetDeployments();
    registerDeployment('ethereum-sepolia', {});
    registerDeployment('arc-testnet', { intentRouter: ROUTER_ARC, liquidityVault: VAULT_ARC });
    expect(() => loadSolverConfig(baseEnv())).toThrow(ConfigError);
  });

  it('refuses a zero or negative poll interval', () => {
    expect(() => loadSolverConfig({ ...baseEnv(), SOLVER_POLL_INTERVAL_MS: '0' })).toThrow(ConfigError);
    expect(() => loadSolverConfig({ ...baseEnv(), SOLVER_POLL_INTERVAL_MS: '-5' })).toThrow(ConfigError);
  });

  it('refuses a non-numeric poll interval', () => {
    expect(() => loadSolverConfig({ ...baseEnv(), SOLVER_POLL_INTERVAL_MS: 'soon' })).toThrow(ConfigError);
  });

  it('refuses a zero or negative authorization TTL', () => {
    expect(() => loadSolverConfig({ ...baseEnv(), SOLVER_AUTHORIZATION_TTL_SECONDS: '0' })).toThrow(ConfigError);
  });

  it('honours a quote port override', () => {
    const config = loadSolverConfig({ ...baseEnv(), SOLVER_QUOTE_PORT: '9001' });
    expect(config.quotePort).toBe(9001);
  });

  it('refuses an invalid quote port', () => {
    expect(() => loadSolverConfig({ ...baseEnv(), SOLVER_QUOTE_PORT: '0' })).toThrow(ConfigError);
    expect(() => loadSolverConfig({ ...baseEnv(), SOLVER_QUOTE_PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadSolverConfig({ ...baseEnv(), SOLVER_QUOTE_PORT: 'soon' })).toThrow(ConfigError);
  });
});
