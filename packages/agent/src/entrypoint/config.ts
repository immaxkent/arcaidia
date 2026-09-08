/**
 * Config for the live solver process.
 *
 * Takes an env record as a plain argument rather than reading `process.env`
 * itself, so parsing every failure mode — a missing subgraph URL, a malformed
 * private key — is a unit test, not something only discoverable by actually
 * starting the process. Per-chain contract addresses and default RPC URLs
 * come from `@arcaidia/domain`'s committed config, never retyped here — the
 * one thing this file adds is what that config doesn't know: secrets, and
 * where the subgraphs live.
 */

import { CHAINS, deploymentFor, type ChainKey } from '@arcaidia/domain';

export interface ChainEntrypointConfig {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly intentRouter: `0x${string}`;
  readonly liquidityVault: `0x${string}`;
  readonly subgraphUrl: string;
}

export interface SolverEntrypointConfig {
  readonly signerPrivateKey: `0x${string}`;
  readonly submitterPrivateKey: `0x${string}`;
  readonly pollIntervalMs: number;
  readonly authorizationTtlSeconds: number;
  readonly chains: readonly [ChainEntrypointConfig, ChainEntrypointConfig];
}

export class ConfigError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

function requireHex(env: Env, key: string): `0x${string}` {
  const value = env[key];
  if (!value) throw new ConfigError(`${key} is not set.`);
  if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new ConfigError(`${key} is not a 0x-prefixed hex value.`);
  return value as `0x${string}`;
}

function requireUrl(env: Env, key: string): string {
  const value = env[key];
  if (!value) {
    throw new ConfigError(
      `${key} is not set. The solver reads pending intents from The Graph — it will ` +
        'not fall back to a local/in-memory view for a live run, since that would look ' +
        'like it is watching both chains when it is actually watching neither.',
    );
  }
  return value;
}

const CHAIN_ENV_PREFIX: Record<ChainKey, string> = {
  'ethereum-sepolia': 'ETHEREUM_SEPOLIA',
  'arc-testnet': 'ARC_TESTNET',
};

function chainConfig(key: ChainKey, env: Env): ChainEntrypointConfig {
  const prefix = CHAIN_ENV_PREFIX[key];
  const chain = CHAINS[key];
  const contracts = deploymentFor(key);

  if (!contracts.intentRouter || !contracts.liquidityVault) {
    throw new ConfigError(
      `${chain.name} has no deployed IntentRouter/LiquidityVault in packages/domain/src/config/deployments.ts.`,
    );
  }

  return {
    chainId: chain.chainId,
    rpcUrl: env[`${prefix}_RPC_URL`] || chain.rpcUrl,
    intentRouter: contracts.intentRouter,
    liquidityVault: contracts.liquidityVault,
    subgraphUrl: requireUrl(env, `SUBGRAPH_URL_${prefix}`),
  };
}

export function loadSolverConfig(env: Env): SolverEntrypointConfig {
  const signerPrivateKey = requireHex(env, 'LOCAL_AGENT_PRIVATE_KEY');
  const submitterPrivateKey = requireHex(env, 'LOCAL_SUBMITTER_PRIVATE_KEY');

  const pollIntervalMs = env.SOLVER_POLL_INTERVAL_MS ? Number(env.SOLVER_POLL_INTERVAL_MS) : 10_000;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new ConfigError('SOLVER_POLL_INTERVAL_MS must be a positive number.');
  }

  const authorizationTtlSeconds = env.SOLVER_AUTHORIZATION_TTL_SECONDS
    ? Number(env.SOLVER_AUTHORIZATION_TTL_SECONDS)
    : 45;
  if (!Number.isFinite(authorizationTtlSeconds) || authorizationTtlSeconds <= 0) {
    throw new ConfigError('SOLVER_AUTHORIZATION_TTL_SECONDS must be a positive number.');
  }

  return {
    signerPrivateKey,
    submitterPrivateKey,
    pollIntervalMs,
    authorizationTtlSeconds,
    chains: [chainConfig('ethereum-sepolia', env), chainConfig('arc-testnet', env)],
  };
}
