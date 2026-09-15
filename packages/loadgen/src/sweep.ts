/**
 * Sell the bots' mock tokens back to USDC — WP-34 follow-up (2026-09-15).
 *
 * A trade intent pays the bot in `tokenOut`, not USDC, so every swap drains USDC out of the
 * bot economy for good; overnight both wallets went from ~130 USDC to single digits while
 * holding ~$150 of mETH/mAAVE/mGRT/mPEPE. This sells those back through the same Uniswap V2
 * router the vaults swap on, in slices capped at a share of the pool's USDC reserve so a sweep
 * moves a price by a few percent, not fifty (the market bot restores the rest).
 */
import { createPublicClient, createWalletClient, http, type Chain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { SWAP_INFRASTRUCTURE, type Address } from '@arcaidia/domain';

const ROUTER_ABI = [
  { type: 'function', name: 'getAmountsOut', stateMutability: 'view', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], outputs: [{ name: 'amounts', type: 'uint256[]' }] },
  { type: 'function', name: 'swapExactTokensForTokens', stateMutability: 'nonpayable', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], outputs: [{ name: 'amounts', type: 'uint256[]' }] },
] as const;
const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

export interface SweepChain {
  readonly chainId: number;
  readonly chain: Chain;
  readonly rpcUrl: string;
  readonly usdc: Address;
}

/**
 * How much of `balance` to sell now: all of it if its USDC value is within `maxShare` of the
 * pool's USDC reserve, else the slice that is. Pure, so the sizing is testable.
 */
export function sliceToSell(balance: bigint, quotedUsdc: bigint, poolUsdcReserve: bigint, maxShareBps: bigint): bigint {
  if (balance === 0n || quotedUsdc === 0n) return 0n;
  const cap = (poolUsdcReserve * maxShareBps) / 10_000n;
  if (quotedUsdc <= cap) return balance;
  return (balance * cap) / quotedUsdc;
}

export interface SweepResult {
  readonly chainId: number;
  readonly wallet: Address;
  readonly symbol: string;
  readonly soldTokens: bigint;
  readonly usdcOut: bigint;
  readonly txHash: Hex;
}

/** One pass over every bot, chain and market token. Skips dust (< 0.05 USDC of value). */
export async function sweepTokensToUsdc(
  chains: ReadonlyMap<number, SweepChain>,
  keys: readonly Hex[],
  options: { readonly maxShareBps?: bigint; readonly slippageBps?: bigint; readonly log?: (line: string) => void } = {},
): Promise<SweepResult[]> {
  const maxShareBps = options.maxShareBps ?? 800n;
  const slippageBps = options.slippageBps ?? 300n;
  const log = options.log ?? (() => {});
  const results: SweepResult[] = [];
  for (const infra of Object.values(SWAP_INFRASTRUCTURE)) {
    if (!infra) continue;
    const endpoint = chains.get(infra.chainId);
    if (!endpoint) continue;
    const publicClient = createPublicClient({ chain: endpoint.chain, transport: http(endpoint.rpcUrl) });
    for (const key of keys) {
      const account = privateKeyToAccount(key);
      const wallet = createWalletClient({ account, chain: endpoint.chain, transport: http(endpoint.rpcUrl) });
      for (const market of infra.markets) {
        const token = market.tokenOut.address;
        try {
          const balance = (await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })) as bigint;
          if (balance === 0n) continue;
          const [, quoted] = (await publicClient.readContract({ address: infra.router, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [balance, [token, endpoint.usdc]] })) as readonly bigint[];
          if (quoted === undefined || quoted < 50_000n) continue; // < 0.05 USDC: dust
          const reserve = (await publicClient.readContract({ address: endpoint.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [market.pool] })) as bigint;
          const amountIn = sliceToSell(balance, quoted, reserve, maxShareBps);
          if (amountIn === 0n) continue;
          const [, out] = (await publicClient.readContract({ address: infra.router, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [amountIn, [token, endpoint.usdc]] })) as readonly bigint[];
          const minOut = ((out ?? 0n) * (10_000n - slippageBps)) / 10_000n;
          const allowance = (await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, infra.router] })) as bigint;
          if (allowance < amountIn) {
            const a = await wallet.writeContract({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [infra.router, 2n ** 255n] });
            await publicClient.waitForTransactionReceipt({ hash: a });
          }
          const txHash = await wallet.writeContract({ address: infra.router, abi: ROUTER_ABI, functionName: 'swapExactTokensForTokens', args: [amountIn, minOut, [token, endpoint.usdc], account.address, BigInt(Math.floor(Date.now() / 1000) + 600)] });
          const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
          if (receipt.status !== 'success') { log(`sweep ${market.tokenOut.symbol} on ${infra.chainId} for ${account.address.slice(0, 8)} reverted`); continue; }
          results.push({ chainId: infra.chainId, wallet: account.address, symbol: market.tokenOut.symbol, soldTokens: amountIn, usdcOut: out ?? 0n, txHash });
          log(`swept ${(Number(amountIn) / 1e18).toPrecision(4)} ${market.tokenOut.symbol} -> ~${(Number(out ?? 0n) / 1e6).toFixed(2)} USDC on ${infra.chainId} for ${account.address.slice(0, 8)}`);
        } catch (error) {
          log(`sweep ${market.tokenOut.symbol} on ${infra.chainId} failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
        }
      }
    }
  }
  return results;
}
