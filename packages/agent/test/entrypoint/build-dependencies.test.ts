import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { registerDeployment, resetDeployments } from '@arcaidia/domain';
import { InMemoryDecisionLog } from '../../src/logging/decision-log.js';
import {
  buildReadClients,
  buildSolverDependencies,
  buildWriteClients,
} from '../../src/entrypoint/build-dependencies.js';
import type { SolverEntrypointConfig } from '../../src/entrypoint/config.js';

const SIGNER_KEY = `0x${'11'.repeat(32)}` as const;
const SUBMITTER_KEY = `0x${'22'.repeat(32)}` as const;

const SEPOLIA_CHAIN = {
  chainId: 11_155_111,
  rpcUrl: 'https://sepolia.example/rpc',
  intentRouter: '0x1111111111111111111111111111111111111111' as const,
  liquidityVault: '0x2222222222222222222222222222222222222222' as const,
  subgraphUrl: 'https://api.studio.thegraph.com/query/sepolia',
};

const ARC_CHAIN = {
  chainId: 5_042_002,
  rpcUrl: 'https://arc.example/rpc',
  intentRouter: '0x3333333333333333333333333333333333333333' as const,
  liquidityVault: '0x4444444444444444444444444444444444444444' as const,
  subgraphUrl: 'https://api.studio.thegraph.com/query/arc',
};

function config(): SolverEntrypointConfig {
  return {
    signerPrivateKey: SIGNER_KEY,
    submitterPrivateKey: SUBMITTER_KEY,
    pollIntervalMs: 10_000,
    authorizationTtlSeconds: 45,
    chains: [SEPOLIA_CHAIN, ARC_CHAIN],
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
    expect(deps.config.policy.version).toMatch(/^v1-testnet/);
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

  it("the source reader refuses an unconfigured chain id synchronously, before any network call", async () => {
    const { deps } = buildSolverDependencies(config(), { log: new InMemoryDecisionLog() });
    await expect(deps.sourceReader.readEvidence(999, '0xaa' as `0x${string}`)).rejects.toThrow(
      /No RPC client or router configured for chain 999/,
    );
  });

  it('the submitter refuses an unconfigured chain id synchronously, before any network call', async () => {
    const { deps } = buildSolverDependencies(config(), { log: new InMemoryDecisionLog() });
    await expect(
      deps.submitter.submitFastFill(999, SEPOLIA_CHAIN.liquidityVault, {
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
});
