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

/**
 * WP-09: the fill-authorization signer is either a locally held key
 * (`LocalAgentSigner`) or a Circle Agent Wallet (`CircleAgentWalletSigner`) —
 * never both, and never silently one when the other was intended. Selected
 * by which set of env vars is present; a partially set Circle config is a
 * `ConfigError`, not a silent fall-back to local.
 */
export type SignerAuthorityConfig =
  | { readonly mode: 'local'; readonly privateKey: `0x${string}` }
  | {
      readonly mode: 'circle';
      readonly apiKey: string;
      readonly entitySecret: string;
      readonly walletId: string;
      readonly address: `0x${string}`;
    };

export interface SolverEntrypointConfig {
  readonly signerAuthority: SignerAuthorityConfig;
  readonly submitterPrivateKey: `0x${string}`;
  readonly pollIntervalMs: number;
  readonly authorizationTtlSeconds: number;
  /** POST /quote (WP-14) — colocated in this process; see quote-server.ts. */
  readonly quotePort: number;
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

const CIRCLE_KEYS = [
  'CIRCLE_API_KEY',
  'CIRCLE_ENTITY_SECRET',
  'CIRCLE_AGENT_WALLET_ID',
  'CIRCLE_AGENT_WALLET_ADDRESS',
] as const;

function loadSignerAuthority(env: Env): SignerAuthorityConfig {
  const circlePresent = CIRCLE_KEYS.filter((key) => Boolean(env[key]));

  if (circlePresent.length === 0) {
    return { mode: 'local', privateKey: requireHex(env, 'LOCAL_AGENT_PRIVATE_KEY') };
  }

  if (circlePresent.length < CIRCLE_KEYS.length) {
    const missing = CIRCLE_KEYS.filter((key) => !env[key]);
    throw new ConfigError(
      `Partial Circle Agent Wallet config: ${circlePresent.join(', ')} set but ${missing.join(', ')} ` +
        'missing. Set all four (WP-09) or none, to fall back to LOCAL_AGENT_PRIVATE_KEY.',
    );
  }

  return {
    mode: 'circle',
    apiKey: env.CIRCLE_API_KEY as string,
    entitySecret: env.CIRCLE_ENTITY_SECRET as string,
    walletId: env.CIRCLE_AGENT_WALLET_ID as string,
    address: requireHex(env, 'CIRCLE_AGENT_WALLET_ADDRESS'),
  };
}

export function loadSolverConfig(env: Env): SolverEntrypointConfig {
  const signerAuthority = loadSignerAuthority(env);
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

  const quotePort = env.SOLVER_QUOTE_PORT ? Number(env.SOLVER_QUOTE_PORT) : 8787;
  if (!Number.isInteger(quotePort) || quotePort <= 0 || quotePort > 65_535) {
    throw new ConfigError('SOLVER_QUOTE_PORT must be a valid port number.');
  }

  return {
    signerAuthority,
    submitterPrivateKey,
    pollIntervalMs,
    authorizationTtlSeconds,
    quotePort,
    chains: [chainConfig('ethereum-sepolia', env), chainConfig('arc-testnet', env)],
  };
}
