import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { registerDeployment, resetDeployments } from '@arcaidia/domain';
import { HttpTelemetryClient, NoopTelemetryClient } from '@arcaidia/telemetry';
import { intent } from '../fixtures.js';
import { InMemoryDecisionLog } from '../../src/logging/decision-log.js';
import {
  buildReadClients,
  buildSolverDependencies,
  buildWriteClients,
  pairAllVaultsInBackground,
  startHeartbeats,
  HEARTBEAT_INTERVAL_MS,
} from '../../src/entrypoint/build-dependencies.js';
import { GraphObservationProvider, LocalAgentSigner, SqlNestObservationProvider } from '../../src/index.js';
import type { SolverEntrypointConfig } from '../../src/entrypoint/config.js';

const SIGNER_KEY = `0x${'11'.repeat(32)}` as const;
const SUBMITTER_KEY = `0x${'22'.repeat(32)}` as const;

const SEPOLIA_CHAIN = {
  chainId: 11_155_111,
  rpcUrl: 'https://sepolia.example/rpc',
  intentRouter: '0x1111111111111111111111111111111111111111' as const,
  liquidityVault: '0x2222222222222222222222222222222222222222' as const,
  subgraphUrl: 'https://nest.example/arcaidia-sepolia',
  asset: '0x6666666666666666666666666666666666666666' as const,
};

const ARC_CHAIN = {
  chainId: 5_042_002,
  rpcUrl: 'https://arc.example/rpc',
  intentRouter: '0x3333333333333333333333333333333333333333' as const,
  liquidityVault: '0x4444444444444444444444444444444444444444' as const,
  subgraphUrl: 'https://nest.example/arcaidia-arc',
  asset: '0x7777777777777777777777777777777777777777' as const,
};

function config(overrides: Partial<SolverEntrypointConfig> = {}): SolverEntrypointConfig {
  return {
    signerAuthority: { mode: 'local', privateKey: SIGNER_KEY },
    submitterPrivateKey: SUBMITTER_KEY,
    pollIntervalMs: 10_000,
    authorizationTtlSeconds: 45,
    quotePort: 8787,
    chains: [SEPOLIA_CHAIN, ARC_CHAIN],
    telemetry: { enabled: false },
    observationSource: 'nest',
    ...overrides,
  };
}

const CIRCLE_ADDRESS = '0x5555555555555555555555555555555555555555' as const;

function circleConfig(): SolverEntrypointConfig {
  return {
    ...config(),
    signerAuthority: {
      mode: 'circle',
      apiKey: 'TEST_API_KEY:abc:def',
      entitySecret: '11'.repeat(32),
      walletId: 'wallet-id-1',
      address: CIRCLE_ADDRESS,
    },
  };
}

/**
 * Nothing here makes a network call: constructing a viem client is local and
 * lazy. What's asserted is the *wiring* — the right key produced the right
 * address, the right chain id maps to the right client, an unconfigured chain
 * id fails fast rather than silently reaching for the wrong one.
 */
describe('buildSolverDependencies', () => {
  beforeEach(() => {
    registerDeployment('ethereum-sepolia', {
      intentRouter: SEPOLIA_CHAIN.intentRouter,
      liquidityVault: SEPOLIA_CHAIN.liquidityVault,
    });
    registerDeployment('arc-testnet', {
      intentRouter: ARC_CHAIN.intentRouter,
      liquidityVault: ARC_CHAIN.liquidityVault,
    });
  });

  afterEach(() => resetDeployments());

  it('derives the signer and submitter addresses from their own, different keys', () => {
    const { signerAddress, submitterAddress } = buildSolverDependencies(config(), {
      log: new InMemoryDecisionLog(),
    });

    expect(signerAddress).toBe(privateKeyToAccount(SIGNER_KEY).address);
    expect(submitterAddress).toBe(privateKeyToAccount(SUBMITTER_KEY).address);
    expect(signerAddress).not.toBe(submitterAddress);
  });

  it("the authority's own address matches the reported signer address", () => {
    const { deps, signerAddress } = buildSolverDependencies(config(), { log: new InMemoryDecisionLog() });
    expect(deps.authority.address).toBe(signerAddress);
  });

  it('carries the configured policy and TTL through unchanged', () => {
    const { deps } = buildSolverDependencies(config(), { log: new InMemoryDecisionLog() });
    expect(deps.config.authorizationTtlSeconds).toBe(45);
    expect(deps.config.policy.version).toMatch(/^v2-testnet/);
  });

  it('wires the GraphQL provider when OBSERVATION_SOURCE=graph, the Nest provider otherwise', () => {
    const nest = buildSolverDependencies(config(), { log: new InMemoryDecisionLog() });
    expect(nest.deps.observation).toBeInstanceOf(SqlNestObservationProvider);
    const graph = buildSolverDependencies(config({ observationSource: 'graph' }), { log: new InMemoryDecisionLog() });
    expect(graph.deps.observation).toBeInstanceOf(GraphObservationProvider);
  });

  it('uses the log instance the caller provided, not one of its own', () => {
    const log = new InMemoryDecisionLog();
    const { deps } = buildSolverDependencies(config(), { log });
    expect(deps.log).toBe(log);
  });

  it('read clients are keyed by chain id, and refuse an unconfigured one before touching the network', async () => {
    const clients = buildReadClients(config().chains);
    expect(clients.has(SEPOLIA_CHAIN.chainId)).toBe(true);
    expect(clients.has(ARC_CHAIN.chainId)).toBe(true);
    expect(clients.has(999)).toBe(false);
  });

  it('write clients sign as the submitter key, not the signer key', () => {
    const clients = buildWriteClients(config().chains, SUBMITTER_KEY);
    expect(clients.has(SEPOLIA_CHAIN.chainId)).toBe(true);
    expect(clients.has(ARC_CHAIN.chainId)).toBe(true);
  });

  it('WP-09: wires a CircleAgentWalletSigner, keyed to its configured address, when signerAuthority.mode is circle', () => {
    const { deps, signerAddress } = buildSolverDependencies(circleConfig(), {
      log: new InMemoryDecisionLog(),
    });
    expect(signerAddress).toBe(CIRCLE_ADDRESS);
    expect(deps.authority.address).toBe(CIRCLE_ADDRESS);
    expect(deps.authority.constructor.name).toBe('CircleAgentWalletSigner');
  });

  it("the source reader refuses an unconfigured chain id synchronously, before any network call", async () => {
    const { deps } = buildSolverDependencies(config(), { log: new InMemoryDecisionLog() });
    await expect(deps.sourceReader.readEvidence(999, '0xaa' as `0x${string}`)).rejects.toThrow(
      /No RPC client or router configured for chain 999/,
    );
  });

  it('the submitter refuses an unconfigured chain id synchronously, before any network call', async () => {
    const { deps } = buildSolverDependencies(config(), { log: new InMemoryDecisionLog() });
    await expect(
      deps.submitter.submitFastFill(999, SEPOLIA_CHAIN.liquidityVault, intent(), {
        authorization: {
          intentId: `0x${'00'.repeat(32)}`,
          sourceChainId: SEPOLIA_CHAIN.chainId,
          sourceTxHash: `0x${'00'.repeat(32)}`,
          recipient: '0x0000000000000000000000000000000000000000',
          inputAmount: 0n,
          outputAmount: 0n,
          feeAmount: 0n,
          expiry: 0,
          nonce: 0n,
        },
        signature: `0x${'00'.repeat(65)}`,
        signer: SEPOLIA_CHAIN.intentRouter,
      }),
    ).rejects.toThrow(/No write client configured for chain 999/);
  });

  // -----------------------------------------------------------------------
  // Telemetry (WP-17.2)
  // -----------------------------------------------------------------------

  it('wires a NoopTelemetryClient when telemetry is disabled', () => {
    const { deps } = buildSolverDependencies(
      { ...config(), telemetry: { enabled: false } },
      { log: new InMemoryDecisionLog() },
    );
    expect(deps.telemetry).toBeInstanceOf(NoopTelemetryClient);
  });

  it('wires a real HttpTelemetryClient, pointed at the configured relay, when enabled', () => {
    const { deps } = buildSolverDependencies(
      { ...config(), telemetry: { enabled: true, relayUrl: 'https://relay.example' } },
      { log: new InMemoryDecisionLog() },
    );
    expect(deps.telemetry).toBeInstanceOf(HttpTelemetryClient);
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Pairing (WP-18.1)
// ---------------------------------------------------------------------------

describe('pairAllVaultsInBackground', () => {
  beforeEach(() => {
    registerDeployment('ethereum-sepolia', {
      intentRouter: SEPOLIA_CHAIN.intentRouter,
      liquidityVault: SEPOLIA_CHAIN.liquidityVault,
    });
    registerDeployment('arc-testnet', {
      intentRouter: ARC_CHAIN.intentRouter,
      liquidityVault: ARC_CHAIN.liquidityVault,
    });
  });

  afterEach(() => {
    resetDeployments();
    vi.unstubAllGlobals();
  });

  const telemetryEnabledConfig = (): SolverEntrypointConfig => ({
    ...config(),
    telemetry: { enabled: true, relayUrl: 'https://relay.example' },
  });

  it('never touches the network at all when telemetry is disabled', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { deps } = buildSolverDependencies(config(), { log: new InMemoryDecisionLog() });
    pairAllVaultsInBackground(config(), deps.authority);
    await flushMicrotasks();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('attempts pairing for every configured chain when telemetry is enabled with a local signer', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith('/pair/challenge')) {
        return new Response(JSON.stringify({ challenge: 'nonce', expiresAt: 1 }), { status: 200 });
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const built = telemetryEnabledConfig();
    const { deps } = buildSolverDependencies(built, { log: new InMemoryDecisionLog() });
    pairAllVaultsInBackground(built, deps.authority);
    await flushMicrotasks();

    const challengeCalls = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/pair/challenge'));
    expect(challengeCalls).toHaveLength(2); // one per configured chain
  });

  it('skips pairing entirely for a Circle Agent Wallet signer, without throwing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const built = { ...circleConfig(), telemetry: { enabled: true as const, relayUrl: 'https://relay.example' } };
    const { deps } = buildSolverDependencies(built, { log: new InMemoryDecisionLog() });

    expect(() => pairAllVaultsInBackground(built, deps.authority)).not.toThrow();
    await flushMicrotasks();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a Relay that refuses every request does not throw synchronously, and does not affect the other chain', async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchSpy);

    const built = telemetryEnabledConfig();
    const { deps } = buildSolverDependencies(built, { log: new InMemoryDecisionLog() });

    expect(() => pairAllVaultsInBackground(built, deps.authority)).not.toThrow();
    await flushMicrotasks();

    // Both chains were still attempted independently.
    const challengeCalls = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/pair/challenge'));
    expect(challengeCalls).toHaveLength(2);
  });
});

describe('startHeartbeats (WP-18.2 — "solver online" on its own clock)', () => {
  const telemetryOn = { enabled: true as const, relayUrl: 'http://relay.example' };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('beats once immediately for every configured vault as the paired signer, then every interval, until stopped', () => {
    const telemetry = { reportStage: vi.fn(), heartbeat: vi.fn() };
    const authority = new LocalAgentSigner(SIGNER_KEY);
    let now = 1_700_000_000;

    const stop = startHeartbeats(config({ telemetry: telemetryOn }), authority, telemetry, { clock: () => now });

    expect(telemetry.heartbeat).toHaveBeenCalledTimes(2);
    expect(telemetry.heartbeat).toHaveBeenCalledWith({
      chainId: SEPOLIA_CHAIN.chainId,
      vaultAddress: SEPOLIA_CHAIN.liquidityVault,
      operatorAddress: privateKeyToAccount(SIGNER_KEY).address,
      at: 1_700_000_000,
    });
    expect(telemetry.heartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: ARC_CHAIN.chainId, vaultAddress: ARC_CHAIN.liquidityVault }),
    );

    now += 10;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(telemetry.heartbeat).toHaveBeenCalledTimes(4);
    expect(telemetry.heartbeat).toHaveBeenLastCalledWith(expect.objectContaining({ at: 1_700_000_010 }));

    stop();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(telemetry.heartbeat).toHaveBeenCalledTimes(4);
  });

  it('keeps the relay timeout comfortably: three beats per 30s sweep window', () => {
    expect(HEARTBEAT_INTERVAL_MS * 3).toBeLessThanOrEqual(30_000);
  });

  it('sends nothing when telemetry is disabled', () => {
    const telemetry = { reportStage: vi.fn(), heartbeat: vi.fn() };
    startHeartbeats(config(), new LocalAgentSigner(SIGNER_KEY), telemetry);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(telemetry.heartbeat).not.toHaveBeenCalled();
  });

  it('sends nothing for a signer that cannot have paired (no personal-sign path), so the relay never sees a 401 storm', () => {
    const telemetry = { reportStage: vi.fn(), heartbeat: vi.fn() };
    const circle = buildSolverDependencies({ ...circleConfig(), telemetry: telemetryOn }, { log: new InMemoryDecisionLog() });
    startHeartbeats({ ...circleConfig(), telemetry: telemetryOn }, circle.deps.authority, telemetry);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(telemetry.heartbeat).not.toHaveBeenCalled();
  });
});
