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
import type { PlannedIntent } from './phases.js';

export interface SubmittedIntent {
  readonly intentId: Hex;
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

  async submit(intent: PlannedIntent, walletIndex: number): Promise<SubmittedIntent> {
    const endpoint = this.endpoints.get(intent.sourceChainId);
    if (!endpoint) throw new Error(`No endpoint configured for chain ${intent.sourceChainId}.`);
    const key = this.keys[walletIndex];
    if (!key) throw new Error(`No user key at index ${walletIndex}.`);
    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: endpoint.chain, transport: http(endpoint.rpcUrl) });
    const wallet = createWalletClient({ account, chain: endpoint.chain, transport: http(endpoint.rpcUrl) });

    const approvalKey = `${endpoint.chainId}:${account.address}`;
    if (!this.approved.has(approvalKey)) {
      const allowance = await publicClient.readContract({ address: endpoint.usdc, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, endpoint.router] });
      if (allowance < intent.amount * 1_000n) {
        const hash = await wallet.writeContract({ address: endpoint.usdc, abi: ERC20_ABI, functionName: 'approve', args: [endpoint.router, 2n ** 255n] });
        await publicClient.waitForTransactionReceipt({ hash });
      }
      this.approved.add(approvalKey);
    }

    const nonce = this.nonceCounter++;
    const deadline = BigInt(this.clock() + intent.deadlineSeconds);
    const txHash = await wallet.writeContract({
      address: endpoint.router,
      abi: ROUTER_ABI,
      functionName: 'createIntent',
      args: [account.address, intent.amount, BigInt(intent.destinationChainId), intent.maxFeeBps, deadline, nonce, USDC_TOKEN_OUT, 0n],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') throw new Error(`createIntent ${txHash} reverted.`);

    const [topic] = encodeEventTopics({ abi: ROUTER_ABI, eventName: 'IntentCreated' });
    const log = receipt.logs.find((l) => l.address.toLowerCase() === endpoint.router.toLowerCase() && l.topics[0] === topic);
    if (!log) throw new Error(`createIntent ${txHash} emitted no IntentCreated.`);
    const decoded = decodeEventLog({ abi: ROUTER_ABI, eventName: 'IntentCreated', topics: log.topics, data: log.data });
    return { intentId: decoded.args.intentId, txHash, from: account.address, nonce, submittedAt: this.clock() };
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
