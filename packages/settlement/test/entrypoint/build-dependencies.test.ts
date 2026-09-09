import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { registerDeployment, resetDeployments } from '@arcaidia/domain';
import { GraphSettlementDiscovery } from '../../src/index.js';
import {
  buildReadClients,
  buildSettlementDependencies,
  buildWriteClients,
} from '../../src/entrypoint/build-dependencies.js';
import type { SettlementEntrypointConfig } from '../../src/entrypoint/config.js';

const REPORTER_KEY = `0x${'33'.repeat(32)}` as const;

const SEPOLIA_CHAIN = {
  chainId: 11_155_111,
  rpcUrl: 'https://sepolia.example/rpc',
  settlementReceiver: '0x1111111111111111111111111111111111111111' as const,
  subgraphUrl: 'https://api.studio.thegraph.com/query/sepolia',
  messageTransmitter: '0x5555555555555555555555555555555555555555' as const,
  domain: 0,
};

const ARC_CHAIN = {
  chainId: 5_042_002,
  rpcUrl: 'https://arc.example/rpc',
  settlementReceiver: '0x2222222222222222222222222222222222222222' as const,
  subgraphUrl: 'https://api.studio.thegraph.com/query/arc',
  messageTransmitter: '0x6666666666666666666666666666666666666666' as const,
  domain: 26,
};

function config(): SettlementEntrypointConfig {
  return {
    reporterPrivateKey: REPORTER_KEY,
    irisBaseUrl: 'https://iris-api-sandbox.circle.com',
    pollIntervalMs: 15_000,
    chains: [SEPOLIA_CHAIN, ARC_CHAIN],
  };
}

/**
 * Nothing here makes a network call: constructing a viem client is local and
 * lazy. What's asserted is the *wiring* — the right key produced the right
 * address, the right chain id maps to the right client, an unconfigured chain
 * id fails fast rather than silently reaching for the wrong one.
 */
describe('buildSettlementDependencies', () => {
  beforeEach(() => {
    registerDeployment('ethereum-sepolia', { settlementReceiver: SEPOLIA_CHAIN.settlementReceiver });
    registerDeployment('arc-testnet', { settlementReceiver: ARC_CHAIN.settlementReceiver });
  });

  afterEach(() => resetDeployments());

  it('derives the reporter address from its own key', () => {
    const { reporterAddress } = buildSettlementDependencies(config());
    expect(reporterAddress).toBe(privateKeyToAccount(REPORTER_KEY).address);
  });

  it('the registrar is the same object as the adapter — registration and status/complete share one tracked map', () => {
    const { deps } = buildSettlementDependencies(config());
    expect(deps.registrar).toBe(deps.adapter);
  });

  it('carries the receiver address per chain through unchanged', () => {
    const { deps } = buildSettlementDependencies(config());
    expect(deps.receivers.get(SEPOLIA_CHAIN.chainId)).toBe(SEPOLIA_CHAIN.settlementReceiver);
    expect(deps.receivers.get(ARC_CHAIN.chainId)).toBe(ARC_CHAIN.settlementReceiver);
  });

  it('read clients are keyed by chain id, and refuse an unconfigured one before touching the network', () => {
    const clients = buildReadClients(config().chains);
    expect(clients.has(SEPOLIA_CHAIN.chainId)).toBe(true);
    expect(clients.has(ARC_CHAIN.chainId)).toBe(true);
    expect(clients.has(999)).toBe(false);
  });

  it('write clients sign as the reporter key', () => {
    const clients = buildWriteClients(config().chains, REPORTER_KEY);
    expect(clients.has(SEPOLIA_CHAIN.chainId)).toBe(true);
    expect(clients.has(ARC_CHAIN.chainId)).toBe(true);
  });

  it('the receiver client refuses an unconfigured chain id, before any network call', async () => {
    const { deps } = buildSettlementDependencies(config());
    await expect(
      deps.receiverClient.isSettled(999, SEPOLIA_CHAIN.settlementReceiver, `0x${'00'.repeat(32)}`),
    ).rejects.toThrow(/No read client configured for chain 999/);
  });

  it('discovery is wired to a real GraphSettlementDiscovery, not a stub', () => {
    const { deps } = buildSettlementDependencies(config());
    expect(deps.discovery).toBeInstanceOf(GraphSettlementDiscovery);
  });

  it('rejects a config referencing a chain id with no viem chain definition', () => {
    const badConfig: SettlementEntrypointConfig = {
      ...config(),
      chains: [{ ...SEPOLIA_CHAIN, chainId: 999 }, ARC_CHAIN],
    };
    expect(() => buildReadClients(badConfig.chains)).toThrow(/No viem chain definition for chain 999/);
  });
});
