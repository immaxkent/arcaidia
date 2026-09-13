/**
 * The Nest's `intents` rows can lag the chain: a fill by a vault the Nest has no data source for,
 * or a settlement on a receiver it does not yet index, leaves an intent looking "pending" long
 * after the recipient was paid. `outstandingIntentVolume` is sold as a market fact, so before
 * an intent counts as open, the destination chain's `SettlementReceiver.outcomeOf(intentId)` is
 * asked — one multicall per chain, cached with everything else. Outcome `NONE` (0) means truly
 * open; anything else means settled (LP reimbursed, recipient paid by fallback, or held).
 */
import { createPublicClient, http, type Chain } from 'viem';
import { sepolia } from 'viem/chains';

export interface SettlementProbe {
  /** Intent id → outcome (0 = NONE). Ids missing from the map could not be checked and stay counted. */
  outcomes(chainId: number, intentIds: readonly `0x${string}`[]): Promise<Map<string, number>>;
}

export interface ProbeChain {
  readonly chainId: number;
  readonly rpcUrl: string;
  /** Live receiver first, then retired ones (D12) — settled on any of them is settled. */
  readonly settlementReceivers: readonly `0x${string}`[];
}

const OUTCOME_ABI = [
  { type: 'function', name: 'outcomeOf', stateMutability: 'view', inputs: [{ name: 'intentId', type: 'bytes32' }], outputs: [{ type: 'uint8' }] },
] as const;

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

function chainFor(chainId: number, rpcUrl: string): Chain {
  if (chainId === sepolia.id) return { ...sepolia, rpcUrls: { default: { http: [rpcUrl] } } };
  return {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    contracts: { multicall3: { address: MULTICALL3 } },
  };
}

export class ViemSettlementProbe implements SettlementProbe {
  private readonly chains = new Map<number, ProbeChain>();

  constructor(chains: readonly ProbeChain[], private readonly batchSize = 100) {
    for (const c of chains) this.chains.set(c.chainId, c);
  }

  async outcomes(chainId: number, intentIds: readonly `0x${string}`[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const chain = this.chains.get(chainId);
    if (!chain || intentIds.length === 0) return result;
    const client = createPublicClient({ chain: chainFor(chainId, chain.rpcUrl), transport: http(chain.rpcUrl) });
    const receivers = chain.settlementReceivers;
    if (receivers.length === 0) return result;
    const perCall = Math.max(1, Math.floor(this.batchSize / receivers.length));
    for (let i = 0; i < intentIds.length; i += perCall) {
      const slice = intentIds.slice(i, i + perCall);
      const answers = await client.multicall({
        allowFailure: true,
        contracts: slice.flatMap((id) => receivers.map((address) => ({ address, abi: OUTCOME_ABI, functionName: 'outcomeOf' as const, args: [id] as const }))),
      });
      slice.forEach((id, j) => {
        const outcomes = receivers.map((_, k) => answers[j * receivers.length + k]).filter((a) => a?.status === 'success').map((a) => Number(a!.result));
        if (outcomes.length === receivers.length) result.set(id.toLowerCase(), Math.max(...outcomes));
      });
    }
    return result;
  }
}
