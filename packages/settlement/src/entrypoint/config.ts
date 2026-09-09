/**
 * Config for the live settlement worker process.
 *
 * Mirrors @arcaidia/agent's entrypoint config exactly, for the identical
 * reason: takes an env record as a plain argument rather than reading
 * `process.env` itself, so parsing every failure mode is a unit test, not
 * something only discoverable by actually starting the process. Per-chain
 * contract addresses, RPC defaults, and CCTP domain/MessageTransmitter
 * addresses all come from `@arcaidia/domain`'s committed config — none of it
 * is secret, so none of it is retyped into env here. The one thing this file
 * adds is what that config doesn't know: secrets, and where the subgraphs and
 * Iris live.
 */

import { chainConfig, deploymentFor, type ChainKey } from '@arcaidia/domain';

export interface ChainEntrypointConfig {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly settlementReceiver: `0x${string}`;
  readonly subgraphUrl: string;
  readonly messageTransmitter: `0x${string}`;
  readonly domain: number;
}

export interface SettlementEntrypointConfig {
  readonly reporterPrivateKey: `0x${string}`;
  readonly irisBaseUrl: string;
  readonly pollIntervalMs: number;
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

function requireUrl(env: Env, key: string, why: string): string {
  const value = env[key];
  if (!value) throw new ConfigError(`${key} is not set. ${why}`);
  return value;
}

const CHAIN_ENV_PREFIX: Record<ChainKey, string> = {
  'ethereum-sepolia': 'ETHEREUM_SEPOLIA',
  'arc-testnet': 'ARC_TESTNET',
};

function chainEntrypointConfig(key: ChainKey, env: Env): ChainEntrypointConfig {
  const prefix = CHAIN_ENV_PREFIX[key];
  const chain = chainConfig(key);
  const contracts = deploymentFor(key);

  if (!contracts.settlementReceiver) {
    throw new ConfigError(
      `${chain.name} has no deployed SettlementReceiver in packages/domain/src/config/deployments.ts.`,
    );
  }

  return {
    chainId: chain.chainId,
    rpcUrl: env[`${prefix}_RPC_URL`] || chain.rpcUrl,
    settlementReceiver: contracts.settlementReceiver,
    subgraphUrl: requireUrl(
      env,
      `SUBGRAPH_URL_${prefix}`,
      'The settlement worker discovers canonically-unsettled intents from The Graph — it ' +
        'will not fall back to a local/in-memory view for a live run, since that would look ' +
        'like it is watching both chains when it is actually watching neither.',
    ),
    messageTransmitter: chain.settlementTransport.messageTransmitter,
    domain: chain.settlementTransport.domain,
  };
}

export function loadSettlementConfig(env: Env): SettlementEntrypointConfig {
  const reporterPrivateKey = requireHex(env, 'LOCAL_REPORTER_PRIVATE_KEY');
  const irisBaseUrl = requireUrl(
    env,
    'CIRCLE_IRIS_BASE_URL',
    'Circle\'s attestation API base URL — https://iris-api-sandbox.circle.com for testnet.',
  );

  const pollIntervalMs = env.SETTLEMENT_POLL_INTERVAL_MS ? Number(env.SETTLEMENT_POLL_INTERVAL_MS) : 15_000;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new ConfigError('SETTLEMENT_POLL_INTERVAL_MS must be a positive number.');
  }

  return {
    reporterPrivateKey,
    irisBaseUrl,
    pollIntervalMs,
    chains: [chainEntrypointConfig('ethereum-sepolia', env), chainEntrypointConfig('arc-testnet', env)],
  };
}
