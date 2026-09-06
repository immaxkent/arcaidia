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
      '--host', '127.0.0.1',
      // Deterministic accounts and no mining delay: the harness controls time.
      '--accounts', '10',
      '--balance', '10000',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Anvil's own output, kept so a startup failure reports its actual reason.
  // Discarding it turns every failure — missing binary, port in use, bad flag —
  // into the same unhelpful readiness timeout.
  let output = '';
  const capture = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 4_000) output = output.slice(-4_000);
  };
  process_.stdout?.on('data', capture);
  process_.stderr?.on('data', capture);
  process_.on('error', (error) => {
    output += `\nspawn error: ${error.message}`;
  });

  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = defineChain({
    id: chainId,
    name: `anvil-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const client = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;

  await waitForChain(client, chainId, process_, () => output);

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
  output: () => string,
): Promise<void> {
  // Generous, because a cold CI runner starting its first anvil is much slower
  // than a warm laptop, and a readiness timeout is the least informative way to
  // fail.
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (process_.exitCode !== null) {
      throw new Error(
        `anvil exited with code ${process_.exitCode} before becoming ready.\n` +
          `anvil said:\n${output().trim() || '(no output)'}`,
      );
    }
    try {
      const id = await client.getChainId();
      if (id !== expectedChainId) {
        throw new Error(`anvil reported chain ${id}, expected ${expectedChainId}.`);
      }

      // A chain with history is not ours. If the port was already taken, our
      // anvil exits and we silently connect to whatever was there — which
      // deploys at different nonces and surfaces much later as a mismatched
      // CREATE2 address, with nothing pointing at the real cause.
      const height = await client.getBlockNumber({ cacheTime: 0 });
      if (height > 0n) {
        throw new Error(
          `A chain is already running on this port at block ${height}. ` +
            'Stop it (pkill -f anvil) and re-run; connecting to it would break ' +
            'deterministic deployment.',
        );
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes('already running')) throw error;
      await sleep(100);
    }
  }

  process_.kill('SIGKILL');
  throw new Error(
    'anvil did not become ready within 60s.\n' +
      `anvil said:\n${output().trim() || '(no output — is foundry on PATH?)'}`,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
