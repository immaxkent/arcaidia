import { describe, expect, it } from 'vitest';
import { CHAINS, CREATE2_FACTORY, type ChainConfig } from '../src/index.js';

/**
 * Assertions about the real chains, run against real RPCs.
 *
 * Every fact recorded in `work-packages/OPEN-QUESTIONS.md` was verified once,
 * by hand, during research. That is worth exactly as much as the day it was
 * done: chains redeploy, testnets get reset, tooling changes underneath you.
 * This turns those one-off checks into something re-runnable.
 *
 * Excluded from `test:global`, which stays hermetic. Run before deploying.
 */

async function rpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

const call = (url: string, to: string, data: string) =>
  rpc<string>(url, 'eth_call', [{ to, data }, 'latest']);

const codeAt = (url: string, address: string) =>
  rpc<string>(url, 'eth_getCode', [address, 'latest']);

const hasCode = async (url: string, address: string) => (await codeAt(url, address)) !== '0x';

const chains = Object.values(CHAINS);

describe.each(chains.map((c) => [c.name, c] as const))('%s', (_name, chain: ChainConfig) => {
  const url = chain.rpcUrl;

  it('reports the chain id our configuration expects', async () => {
    const id = await rpc<string>(url, 'eth_chainId');
    expect(Number(BigInt(id))).toBe(chain.chainId);
  });

  // -----------------------------------------------------------------------
  // Deterministic deployment
  // -----------------------------------------------------------------------

  /// CREATE2 address parity depends on this factory existing at this exact
  /// address on every chain. If it ever stops being true, identical addresses
  /// become unreachable and WP-01's acceptance criterion is void.
  it('hosts the deterministic deployment factory', async () => {
    expect(await hasCode(url, CREATE2_FACTORY)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Settlement transport
  // -----------------------------------------------------------------------

  it.each([
    ['TokenMessenger', (c: ChainConfig) => c.settlementTransport.tokenMessenger],
    ['MessageTransmitter', (c: ChainConfig) => c.settlementTransport.messageTransmitter],
    ['TokenMinter', (c: ChainConfig) => c.settlementTransport.tokenMinter],
  ])('has CCTP %s deployed', async (_label, pick) => {
    expect(await hasCode(url, pick(chain))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Settlement asset
  // -----------------------------------------------------------------------

  it('has the configured settlement asset deployed', async () => {
    expect(await hasCode(url, chain.settlementAsset.address)).toBe(true);
  });

  /// Amounts throughout the protocol assume six decimals. A chain that reported
  /// anything else would make every figure in the system wrong by orders of
  /// magnitude while still typechecking.
  it('reports the decimals our configuration assumes', async () => {
    const result = await call(url, chain.settlementAsset.address, '0x313ce567'); // decimals()
    expect(Number(BigInt(result))).toBe(chain.settlementAsset.decimals);
  });

  // -----------------------------------------------------------------------
  // Fee estimation
  // -----------------------------------------------------------------------

  /// viem — and therefore Privy's embedded wallets, wagmi, and our own
  /// submitter — price transactions from these three surfaces. Arc publishes
  /// the next block's base fee in the parent header's extraData, which is
  /// non-standard; these assertions confirm it *also* populates the ordinary
  /// EIP-1559 fields, so default fee estimation works untouched.
  it('exposes baseFeePerGas on the latest block', async () => {
    const block = await rpc<{ baseFeePerGas?: string }>(url, 'eth_getBlockByNumber', [
      'latest',
      false,
    ]);
    expect(block.baseFeePerGas).toBeDefined();
    expect(BigInt(block.baseFeePerGas!)).toBeGreaterThan(0n);
  });

  it('answers eth_feeHistory with usable percentiles', async () => {
    const history = await rpc<{ baseFeePerGas: string[]; reward?: string[][] }>(
      url,
      'eth_feeHistory',
      ['0x4', 'latest', [25, 50, 75]],
    );
    expect(history.baseFeePerGas.length).toBeGreaterThan(0);
    expect(history.reward?.length ?? 0).toBeGreaterThan(0);
  });

  it('answers eth_maxPriorityFeePerGas', async () => {
    const tip = await rpc<string>(url, 'eth_maxPriorityFeePerGas');
    expect(BigInt(tip)).toBeGreaterThan(0n);
  });
});

describe('across chains', () => {
  /// The factory must be the *same* address everywhere, not merely present
  /// somewhere on each chain.
  it('resolves one deterministic factory address for every chain', () => {
    const factories = new Set(chains.map((c) => c.create2Factory));
    expect(factories.size).toBe(1);
    expect([...factories][0]).toBe(CREATE2_FACTORY);
  });

  it('gives each chain a distinct settlement-transport domain', () => {
    const domains = chains.map((c) => c.settlementTransport.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });
});
