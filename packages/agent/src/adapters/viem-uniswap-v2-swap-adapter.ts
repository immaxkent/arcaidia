/**
 * The solver's read-side view of the destination market — Line 1 §3.
 *
 * MERGE PAYLOAD. This file is copied into Arcaidia at
 * `packages/agent/src/adapters/viem-uniswap-v2-swap-adapter.ts`, where it gains one import
 * and one `implements SwapAdapter`. It is written structurally so it satisfies that
 * interface without depending on Arcaidia from here.
 *
 * It reads the *deployed* `UniswapV2SwapAdapter`, not the pools directly, and that is the
 * whole point: the contract the solver asks is the contract the vault will execute. An
 * off-chain reimplementation of the pricing would be a second opinion, and the two would
 * disagree at exactly the boundary that matters — a trade the solver called satisfiable
 * that the vault then cannot fill, which costs the user a fallback to USDC.
 *
 * The solver only ever reads. Execution happens inside the vault.
 */

import type { SwapAdapter } from '@arcaidia/domain';

export type Address = `0x${string}`;

/** The slice of viem's `PublicClient` this needs. Narrow so a test can supply it. */
export interface ContractReader {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
}

export interface SwapAdapterDeployment {
  readonly address: Address;
  readonly client: ContractReader;
}

const ADAPTER_ABI = [
  {
    type: 'function',
    name: 'quote',
    stateMutability: 'view',
    inputs: [
      {name: 'tokenIn', type: 'address'},
      {name: 'tokenOut', type: 'address'},
      {name: 'amountIn', type: 'uint256'},
    ],
    outputs: [{name: 'amountOut', type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'canSatisfy',
    stateMutability: 'view',
    inputs: [
      {name: 'tokenIn', type: 'address'},
      {name: 'tokenOut', type: 'address'},
      {name: 'amountIn', type: 'uint256'},
      {name: 'minOut', type: 'uint256'},
    ],
    outputs: [{type: 'bool'}],
  },
] as const;

export class ViemUniswapV2SwapAdapter implements SwapAdapter {
  constructor(private readonly deployments: ReadonlyMap<number, SwapAdapterDeployment>) {}

  /**
   * What the destination market would pay for `amountIn` right now.
   *
   * Throws when the chain has no adapter configured or the pair cannot be priced. A quote
   * is used to set a user's floor, so an unanswerable one must be an error rather than a
   * zero that would silently become "any output will do".
   */
  async quote(chainId: number, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint> {
    const deployment = this.deployments.get(chainId);
    if (!deployment) throw new Error(`no swap adapter deployed on chain ${chainId}`);

    return (await deployment.client.readContract({
      address: deployment.address,
      abi: ADAPTER_ABI,
      functionName: 'quote',
      args: [tokenIn, tokenOut, amountIn],
    })) as bigint;
  }

  /**
   * Whether the market can meet `minOut` for `amountIn` right now.
   *
   * Never throws. The solver calls this to decide fill or ignore, and it cannot tell a
   * revert from an unreachable node — so every failure reads as "no", which costs the user
   * a slower canonical settlement rather than a failed fill.
   */
  async canSatisfy(
    chainId: number,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    minOut: bigint,
  ): Promise<boolean> {
    const deployment = this.deployments.get(chainId);
    if (!deployment) return false;

    try {
      return (await deployment.client.readContract({
        address: deployment.address,
        abi: ADAPTER_ABI,
        functionName: 'canSatisfy',
        args: [tokenIn, tokenOut, amountIn, minOut],
      })) as boolean;
    } catch {
      return false;
    }
  }
}
