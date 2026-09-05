/**
 * Local chains.
 *
 * Two anvil instances with distinct chain ids, standing in for Ethereum and
 * Arc. Nothing here reaches the network: the whole point of this harness is
 * that the economic lifecycle can be proven without a single sponsor service
 * running.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createPublicClient, defineChain, http, type Chain, type PublicClient } from 'viem';

export interface AnvilChain {
  readonly chainId: number;
  readonly port: number;
  readonly rpcUrl: string;
  readonly client: PublicClient;
  /**
   * A viem chain definition for this instance.
   *
   * Wallet clients need one to sign locally; without it viem falls back to
   * asking the node to sign, which anvil will not do for an account it does not
   * hold. This is the same `defineChain` shape the frontend will use for Arc.
   */
  readonly chain: Chain;
  stop(): void;
}

export async function startAnvil(chainId: number, port: number): Promise<AnvilChain> {
  const process_ = spawn(
    'anvil',
    [
      '--chain-id', String(chainId),
      '--port', String(port),
      '--silent',
      // Deterministic accounts and no mining delay: the harness controls time.
      '--accounts', '10',
      '--balance', '10000',
    ],
    { stdio: 'ignore' },
  );

  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = defineChain({
    id: chainId,
    name: `anvil-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const client = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;

  await waitForChain(client, chainId, process_);

  return {
    chainId,
    port,
    rpcUrl,
    client,
    chain,
    stop: () => {
      process_.kill('SIGKILL');
    },
  };
}

async function waitForChain(
  client: PublicClient,
  expectedChainId: number,
  process_: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (process_.exitCode !== null) {
      throw new Error(`anvil exited with code ${process_.exitCode} before becoming ready.`);
    }
    try {
      const id = await client.getChainId();
      if (id !== expectedChainId) {
        throw new Error(`anvil reported chain ${id}, expected ${expectedChainId}.`);
      }
      return;
    } catch {
      await sleep(100);
    }
  }

  process_.kill('SIGKILL');
  throw new Error('anvil did not become ready within 30s. Is foundry installed?');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
