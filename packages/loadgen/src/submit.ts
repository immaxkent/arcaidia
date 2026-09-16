/**
 * Submitting a planned intent — the one impure edge of the generator.
 *
 * `ViemIntentSubmitter` does exactly what a user does on /transfer: approve the router once per
 * wallet/chain (max allowance, so the loop is one transaction per intent), then
 * `createIntent` with schema v1.1 terms, reading the real `intentId` back out of the
 * `IntentCreated` event. `DryRunSubmitter` records the plan and sends nothing.
 */
import { createPublicClient, createWalletClient, decodeEventLog, encodeEventTopics, http, type Chain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ABIS, USDC_TOKEN_OUT, type Address } from '@arcaidia/domain';
import { marketsOn, type PlannedIntent } from './phases.js';

/** Below this there is no point sending: fees and gas dominate. */
export const MIN_INTENT_AMOUNT = 1_000_000n;

export interface SubmittedIntent {
  readonly intentId: Hex;
  /** What was actually sent — the planned amount, or less when the wallet could not cover it. */
  readonly amount?: bigint;
  /** The chain it was actually sent from, which is not the planned one when the direction was reversed. */
  readonly sourceChainId?: number;
  /** The chain it was actually sent to, the mirror of `sourceChainId`. */
  readonly destinationChainId?: number;
  readonly txHash: Hex;
  readonly from: Address;
  readonly nonce: bigint;
  readonly submittedAt: number;
}

export interface IntentSubmitter {
  submit(intent: PlannedIntent, walletIndex: number): Promise<SubmittedIntent>;
}

export interface ChainEndpoint {
  readonly chainId: number;
  readonly chain: Chain;
  readonly rpcUrl: string;
  readonly router: Address;
  readonly usdc: Address;
  /** WP-34: the chain's deployed `UniswapV2SwapAdapter`, quoted before a trade intent is sent; null = no market. */
  readonly swapAdapter: Address | null;
}

const ADAPTER_ABI = [
  { type: 'function', name: 'quote', stateMutability: 'view', inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }], outputs: [{ name: 'amountOut', type: 'uint256' }] },
] as const;

/** The widest fee tier a vault posts today; the floor is quoted on the amount the vault would actually swap. */
const ASSUMED_FEE_BPS = 15n;
/** Satisfiable: 3% under the quote (the bot moves prices a little between plan and fill). Unsatisfiable: 50% over it. */
// 15%, not 3%. The floor is quoted when the intent is created and checked again when a solver
// fills it, and the market bot walks these pairs hard (mETH +130% and mPEPE +600% in a day), so
// a tight floor goes stale in the minutes between the two and the trade is declined as
// unreachable. Over 24h only 11 of 27 trade intents reached a swap; the rest expired on drift.
const SATISFIABLE_FLOOR_BPS = 8_500n;
const UNSATISFIABLE_FLOOR_BPS = 15_000n;

/**
 * The floor a planned trade intent carries: the destination adapter's quote for the post-fee
 * amount, scaled down for a fill that should succeed or up for one that should fall back to USDC.
 */
export async function quoteTargetMinOut(
  destination: ChainEndpoint,
  tokenOut: Address,
  amount: bigint,
  unsatisfiable: boolean,
  readContract: (args: { address: Address; abi: typeof ADAPTER_ABI; functionName: 'quote'; args: readonly [Address, Address, bigint] }) => Promise<bigint>,
): Promise<bigint> {
  if (!destination.swapAdapter) throw new Error(`No swap adapter on chain ${destination.chainId}.`);
  const amountIn = amount - (amount * ASSUMED_FEE_BPS) / 10_000n;
  const quoted = await readContract({ address: destination.swapAdapter, abi: ADAPTER_ABI, functionName: 'quote', args: [destination.usdc, tokenOut, amountIn] });
  return (quoted * (unsatisfiable ? UNSATISFIABLE_FLOOR_BPS : SATISFIABLE_FLOOR_BPS)) / 10_000n;
}

const ROUTER_ABI = ABIS.ArcaidiaIntentRouter;
const ERC20_ABI = [
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export class ViemIntentSubmitter implements IntentSubmitter {
  private readonly approved = new Set<string>();
  private nonceCounter: bigint;

  constructor(
    private readonly endpoints: ReadonlyMap<number, ChainEndpoint>,
    private readonly keys: readonly Hex[],
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    // Router nonces are per sender; a time-derived start keeps runs from colliding with earlier ones.
    this.nonceCounter = BigInt(Date.now()) * 1_000n;
  }

  /** USDC this wallet holds on `chainId`, or 0 when that chain is not configured. */
  private async usdcOn(chainId: number, address: Address): Promise<bigint> {
    const endpoint = this.endpoints.get(chainId);
    if (!endpoint) return 0n;
    const client = createPublicClient({ chain: endpoint.chain, transport: http(endpoint.rpcUrl) });
    return (await client.readContract({ address: endpoint.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] })) as bigint;
  }

  /** The planned intent, or the same intent reversed when the other chain funds it better. */
  private async affordableDirection(intent: PlannedIntent, walletIndex: number): Promise<PlannedIntent> {
    const key = this.keys[walletIndex];
    if (!key) return intent;
    const address = privateKeyToAccount(key).address;
    const here = await this.usdcOn(intent.sourceChainId, address);
    // Covering the planned size is the test, not merely clearing the floor: a wallet down to its
    // last few USDC on this chain would otherwise keep sending token 2 USDC intents from the
    // empty side while hundreds sit on the other one, which is how the market stalled before.
    if (here >= intent.amount) return intent;
    const there = await this.usdcOn(intent.destinationChainId, address);
    if (there <= here) return intent; // no better side; submit() clamps or says it cannot pay
    const reversed = { ...intent, sourceChainId: intent.destinationChainId, destinationChainId: intent.sourceChainId };
    if (!intent.trade) return reversed;
    // A trade names a token that only exists on the chain it is delivered to, so reversing one
    // means naming the same market on the new destination. Both chains list the same four
    // symbols; if this one is ever missing, keep the planned direction rather than deliver a
    // token the destination's adapter cannot quote.
    const market = marketsOn(reversed.destinationChainId).find((m) => m.tokenOut.symbol === intent.trade!.symbol);
    if (!market) return intent;
    return { ...reversed, trade: { ...intent.trade, tokenOut: market.tokenOut.address, decimals: market.tokenOut.decimals } };
  }

  async submit(planned: PlannedIntent, walletIndex: number): Promise<SubmittedIntent> {
    // A transfer moves the wallet's USDC from one chain to the other, so a run of intents in one
    // direction empties the sending side and the generator stalls on a chain it cannot pay from.
    // Send it the other way instead when that side has the money: the traffic rebalances itself,
    // which is also what a real user does.
    const intent = await this.affordableDirection(planned, walletIndex);
    const endpoint = this.endpoints.get(intent.sourceChainId);
    if (!endpoint) throw new Error(`No endpoint configured for chain ${intent.sourceChainId}.`);
    const key = this.keys[walletIndex];
    if (!key) throw new Error(`No user key at index ${walletIndex}.`);
    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: endpoint.chain, transport: http(endpoint.rpcUrl) });
    const wallet = createWalletClient({ account, chain: endpoint.chain, transport: http(endpoint.rpcUrl) });

    // A planned intent can outrun what this wallet holds on this chain: sizes are drawn from the
    // profile, but the balance drifts with the direction of recent traffic. Sending anyway burns
    // gas on a certain `ERC20: transfer amount exceeds balance` revert, so clamp to what is
    // actually there (keeping a little back for the next one) and say so.
    const held = (await publicClient.readContract({ address: endpoint.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })) as bigint;
    const affordable = (held * 9_000n) / 10_000n;
    let amount = intent.amount;
    if (amount > affordable) {
      if (affordable < MIN_INTENT_AMOUNT) {
        throw new Error(`wallet ${account.address} holds ${held} on chain ${endpoint.chainId}: too little for any intent`);
      }
      amount = affordable;
    }

    const approvalKey = `${endpoint.chainId}:${account.address}`;
    if (!this.approved.has(approvalKey)) {
      const allowance = await publicClient.readContract({ address: endpoint.usdc, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, endpoint.router] });
      if (allowance < amount * 1_000n) {
        const hash = await wallet.writeContract({ address: endpoint.usdc, abi: ERC20_ABI, functionName: 'approve', args: [endpoint.router, 2n ** 255n] });
        await publicClient.waitForTransactionReceipt({ hash });
      }
      this.approved.add(approvalKey);
    }

    // WP-34: a trade intent names the token and a floor quoted by the destination adapter right now.
    let tokenOut: Address = USDC_TOKEN_OUT;
    let targetMinOut = 0n;
    if (intent.trade) {
      const destination = this.endpoints.get(intent.destinationChainId);
      if (!destination) throw new Error(`No endpoint configured for chain ${intent.destinationChainId}.`);
      const destinationClient = createPublicClient({ chain: destination.chain, transport: http(destination.rpcUrl) });
      tokenOut = intent.trade.tokenOut;
      targetMinOut = await quoteTargetMinOut(destination, tokenOut, amount, intent.trade.unsatisfiable, (args) =>
        destinationClient.readContract(args) as Promise<bigint>,
      );
    }

    const nonce = this.nonceCounter++;
    const deadline = BigInt(this.clock() + intent.deadlineSeconds);
    const txHash = await wallet.writeContract({
      address: endpoint.router,
      abi: ROUTER_ABI,
      functionName: 'createIntent',
      args: [account.address, amount, BigInt(intent.destinationChainId), intent.maxFeeBps, deadline, nonce, tokenOut, targetMinOut],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') throw new Error(`createIntent ${txHash} reverted.`);

    const [topic] = encodeEventTopics({ abi: ROUTER_ABI, eventName: 'IntentCreated' });
    const log = receipt.logs.find((l) => l.address.toLowerCase() === endpoint.router.toLowerCase() && l.topics[0] === topic);
    if (!log) throw new Error(`createIntent ${txHash} emitted no IntentCreated.`);
    const decoded = decodeEventLog({ abi: ROUTER_ABI, eventName: 'IntentCreated', topics: log.topics, data: log.data });
    return {
      intentId: decoded.args.intentId,
      txHash,
      from: account.address,
      nonce,
      submittedAt: this.clock(),
      amount,
      sourceChainId: intent.sourceChainId,
      destinationChainId: intent.destinationChainId,
    };
  }
}

/** Sends nothing; hands back a deterministic pseudo-id so the journal and metrics still work. */
export class DryRunSubmitter implements IntentSubmitter {
  readonly submitted: Array<{ intent: PlannedIntent; walletIndex: number }> = [];
  constructor(private readonly clock: () => number = () => Math.floor(Date.now() / 1000)) {}
  async submit(intent: PlannedIntent, walletIndex: number): Promise<SubmittedIntent> {
    this.submitted.push({ intent, walletIndex });
    const n = this.submitted.length;
    return {
      intentId: `0x${n.toString(16).padStart(64, '0')}` as Hex,
      txHash: `0x${'d'.repeat(64)}` as Hex,
      from: '0x000000000000000000000000000000000000d0d0',
      nonce: BigInt(n),
      submittedAt: this.clock(),
    };
  }
}
