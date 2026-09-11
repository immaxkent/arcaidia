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

    expect(config.signerAuthority).toEqual({ mode: 'local', privateKey: SIGNER_KEY });
    expect(config.submitterPrivateKey).toBe(SUBMITTER_KEY);
    expect(config.pollIntervalMs).toBe(10_000);
    expect(config.authorizationTtlSeconds).toBe(45);
    expect(config.quotePort).toBe(8787);
    expect(config.chains).toHaveLength(2);
    expect(config.telemetry).toEqual({ enabled: false });

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

  // -----------------------------------------------------------------------
  // WP-17.1: the vault address is genuinely per-instance config, not
  // compiled into the committed deployment table — the whole premise of a
  // distributable reference runtime any operator can point at their own vault.
  // -----------------------------------------------------------------------

  it('honours a liquidity vault override without needing one', () => {
    const ownVault = '0x9999999999999999999999999999999999999999';
    const config = loadSolverConfig({ ...baseEnv(), ETHEREUM_SEPOLIA_LIQUIDITY_VAULT: ownVault });
    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    expect(sepolia?.liquidityVault).toBe(ownVault);
  });

  it('falls back to the committed House Vault when no override is set', () => {
    const config = loadSolverConfig(baseEnv());
    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    expect(sepolia?.liquidityVault).toBe(VAULT_SEPOLIA);
  });

  it('rejects a malformed vault override rather than silently ignoring it', () => {
    expect(() =>
      loadSolverConfig({ ...baseEnv(), ETHEREUM_SEPOLIA_LIQUIDITY_VAULT: 'not-an-address' }),
    ).toThrow(ConfigError);
  });

  /// The acceptance-gate scenario, at the config layer: two operators running
  /// the same container image, pointed at different vaults, must never leak
  /// state into each other — each call to loadSolverConfig is independent.
  it('two configs built from different vault overrides stay fully independent', () => {
    const vaultA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const vaultB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const configA = loadSolverConfig({ ...baseEnv(), ETHEREUM_SEPOLIA_LIQUIDITY_VAULT: vaultA });
    const configB = loadSolverConfig({ ...baseEnv(), ETHEREUM_SEPOLIA_LIQUIDITY_VAULT: vaultB });

    const sepoliaA = configA.chains.find((c) => c.chainId === 11_155_111);
    const sepoliaB = configB.chains.find((c) => c.chainId === 11_155_111);
    expect(sepoliaA?.liquidityVault).toBe(vaultA);
    expect(sepoliaB?.liquidityVault).toBe(vaultB);
    // Building configB must not have mutated configA's already-returned object.
    expect(sepoliaA?.liquidityVault).toBe(vaultA);
  });

  it('overriding the vault on one chain leaves the other chain unaffected', () => {
    const ownVault = '0x9999999999999999999999999999999999999999';
    const config = loadSolverConfig({ ...baseEnv(), ETHEREUM_SEPOLIA_LIQUIDITY_VAULT: ownVault });
    const arc = config.chains.find((c) => c.chainId === 5_042_002);
    expect(arc?.liquidityVault).toBe(VAULT_ARC);
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

  // -----------------------------------------------------------------------
  // WP-22: the subgraph/indexer URL is override-with-fallback, same shape as
  // the RPC URL above — unset means Arcaidia's own shared, unlimited Nest,
  // not a thrown ConfigError. An operator with nothing set to look at is a
  // gap the whole point of WP-22 was to close, not a case to keep refusing.
  // -----------------------------------------------------------------------

  it('honours a subgraph URL override without needing one', () => {
    const config = loadSolverConfig({
      ...baseEnv(),
      SUBGRAPH_URL_ETHEREUM_SEPOLIA: 'https://my-own-indexer.example/sepolia',
    });
    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    expect(sepolia?.subgraphUrl).toBe('https://my-own-indexer.example/sepolia');
  });

  it('falls back to the committed default Nest URL when no override is set for either chain', () => {
    const env = baseEnv();
    delete (env as Partial<typeof env>).SUBGRAPH_URL_ETHEREUM_SEPOLIA;
    delete (env as Partial<typeof env>).SUBGRAPH_URL_ARC_TESTNET;

    const config = loadSolverConfig(env);
    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    const arc = config.chains.find((c) => c.chainId === 5_042_002);

    expect(sepolia?.subgraphUrl).toMatch(/^https:\/\//);
    expect(arc?.subgraphUrl).toMatch(/^https:\/\//);
    // An override on one chain must never leak to the other — same rule
    // WP-17.1 already holds for the vault address override.
    expect(sepolia?.subgraphUrl).not.toBe(arc?.subgraphUrl);
  });

  it("carries each chain's settlement asset address through for the Nest provider (WP-22)", () => {
    const config = loadSolverConfig(baseEnv());
    const sepolia = config.chains.find((c) => c.chainId === 11_155_111);
    expect(sepolia?.asset).toMatch(/^0x[0-9a-fA-F]{40}$/);
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

  // --- WP-09: Circle Agent Wallet signer selection ----------------------------

  const CIRCLE_ADDRESS = '0x5555555555555555555555555555555555555555' as const;

  function circleEnv(): Record<string, string> {
    return {
      ...baseEnv(),
      CIRCLE_API_KEY: 'TEST_API_KEY:abc:def',
      CIRCLE_ENTITY_SECRET: '11'.repeat(32),
      CIRCLE_AGENT_WALLET_ID: 'wallet-id-1',
      CIRCLE_AGENT_WALLET_ADDRESS: CIRCLE_ADDRESS,
    };
  }

  it('selects the Circle Agent Wallet authority when all four Circle vars are set', () => {
    const config = loadSolverConfig(circleEnv());
    expect(config.signerAuthority).toEqual({
      mode: 'circle',
      apiKey: 'TEST_API_KEY:abc:def',
      entitySecret: '11'.repeat(32),
      walletId: 'wallet-id-1',
      address: CIRCLE_ADDRESS,
    });
  });

  it('does not require LOCAL_AGENT_PRIVATE_KEY when using the Circle authority', () => {
    const env = circleEnv();
    delete (env as Partial<typeof env>).LOCAL_AGENT_PRIVATE_KEY;
    expect(() => loadSolverConfig(env)).not.toThrow();
  });

  it.each(['CIRCLE_API_KEY', 'CIRCLE_ENTITY_SECRET', 'CIRCLE_AGENT_WALLET_ID', 'CIRCLE_AGENT_WALLET_ADDRESS'])(
    'refuses a partial Circle config missing %s, rather than silently falling back to local',
    (missingKey) => {
      const env = circleEnv();
      delete (env as Partial<typeof env>)[missingKey as keyof typeof env];
      expect(() => loadSolverConfig(env)).toThrow(ConfigError);
      expect(() => loadSolverConfig(env)).toThrow(/Partial Circle Agent Wallet config/);
    },
  );

  it('refuses a Circle wallet address that is not 0x-prefixed hex', () => {
    expect(() =>
      loadSolverConfig({ ...circleEnv(), CIRCLE_AGENT_WALLET_ADDRESS: 'not-an-address' }),
    ).toThrow(ConfigError);
  });

  // -----------------------------------------------------------------------
  // Telemetry (WP-17.2) — disabled is a correct default, not a missing feature
  // -----------------------------------------------------------------------

  describe('telemetry', () => {
    it('defaults to disabled when TELEMETRY_ENABLED is unset', () => {
      const config = loadSolverConfig(baseEnv());
      expect(config.telemetry).toEqual({ enabled: false });
    });

    it('stays disabled for any value other than the literal string "true"', () => {
      const config = loadSolverConfig({ ...baseEnv(), TELEMETRY_ENABLED: '1' });
      expect(config.telemetry).toEqual({ enabled: false });
    });

    it('enables telemetry and carries the relay URL through when both are set', () => {
      const config = loadSolverConfig({
        ...baseEnv(),
        TELEMETRY_ENABLED: 'true',
        ARCAIDIA_TELEMETRY_URL: 'https://relay.example',
      });
      expect(config.telemetry).toEqual({ enabled: true, relayUrl: 'https://relay.example' });
    });

    it('refuses TELEMETRY_ENABLED=true with no relay URL to send anything to', () => {
      expect(() => loadSolverConfig({ ...baseEnv(), TELEMETRY_ENABLED: 'true' })).toThrow(
        ConfigError,
      );
      expect(() => loadSolverConfig({ ...baseEnv(), TELEMETRY_ENABLED: 'true' })).toThrow(
        /ARCAIDIA_TELEMETRY_URL/,
      );
    });
  });
});
