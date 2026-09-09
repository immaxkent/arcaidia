import { describe, expect, it } from 'vitest';
import { GraphSettlementDiscovery, type GraphQueryClient } from '../src/index.js';
import { ARC, SEPOLIA, USDC } from './fixtures.js';

const SEPOLIA_ENDPOINT = 'https://subgraph.local/sepolia';
const ARC_ENDPOINT = 'https://subgraph.local/arc';

const domainFor = (chainId: number): number => (chainId === SEPOLIA ? 0 : 26);

interface RawIntent {
  id: string;
  recipient: string;
  amount: string;
  sourceChainId: string;
  destinationChainId: string;
  settlementRef: string;
  createdAtTimestamp: string;
  createdTxHash: string;
}

function rawIntent(seed: number, overrides: Partial<RawIntent> = {}): RawIntent {
  const hex = seed.toString(16).padStart(4, '0');
  return {
    id: `0x${hex.repeat(16)}`.slice(0, 66),
    recipient: '0x2222222222222222222222222222222222222222',
    amount: USDC(1_000).toString(),
    sourceChainId: String(SEPOLIA),
    destinationChainId: String(ARC),
    settlementRef: `0x${'ab'.repeat(32)}`,
    createdAtTimestamp: '1800000000',
    createdTxHash: `0x${'cd'.repeat(32)}`,
    ...overrides,
  };
}

/** Returns canned `intents` per endpoint; throws when told to, per endpoint. */
class FakeGraphClient implements GraphQueryClient {
  readonly calls: string[] = [];
  responses = new Map<string, RawIntent[]>();
  failWith = new Map<string, Error>();

  async query<T>(endpoint: string): Promise<T> {
    this.calls.push(endpoint);
    const failure = this.failWith.get(endpoint);
    if (failure) throw failure;
    return { intents: this.responses.get(endpoint) ?? [] } as T;
  }
}

describe('GraphSettlementDiscovery', () => {
  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('converts a raw intent into a settlement record', async () => {
    const client = new FakeGraphClient();
    client.responses.set(SEPOLIA_ENDPOINT, [rawIntent(1)]);

    const discovery = new GraphSettlementDiscovery({
      sources: [{ chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT }],
      client,
      domainFor,
    });

    const [record] = await discovery.pendingSettlements();

    expect(record).toBeDefined();
    expect(record!.amount).toBe(USDC(1_000));
    expect(record!.fallbackRecipient).toBe('0x2222222222222222222222222222222222222222');
    expect(record!.reference.sourceChainId).toBe(SEPOLIA);
    expect(record!.reference.destinationChainId).toBe(ARC);
    expect(record!.reference.sourceDomain).toBe(0);
    expect(record!.reference.destinationDomain).toBe(26);
    expect(record!.reference.sourceTxHash).toBe(rawIntent(1).createdTxHash);
    expect(record!.reference.messageRef).toBe(rawIntent(1).settlementRef);
  });

  it('merges results from every configured chain', async () => {
    const client = new FakeGraphClient();
    client.responses.set(SEPOLIA_ENDPOINT, [rawIntent(1)]);
    client.responses.set(ARC_ENDPOINT, [rawIntent(2), rawIntent(3)]);

    const discovery = new GraphSettlementDiscovery({
      sources: [
        { chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT },
        { chainId: ARC, endpoint: ARC_ENDPOINT },
      ],
      client,
      domainFor,
    });

    const records = await discovery.pendingSettlements();
    expect(records).toHaveLength(3);
  });

  it('queries every configured chain, not just the first', async () => {
    const client = new FakeGraphClient();
    const discovery = new GraphSettlementDiscovery({
      sources: [
        { chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT },
        { chainId: ARC, endpoint: ARC_ENDPOINT },
      ],
      client,
      domainFor,
    });

    await discovery.pendingSettlements();
    expect(client.calls.sort()).toEqual([ARC_ENDPOINT, SEPOLIA_ENDPOINT].sort());
  });

  it('returns an empty list when a chain has nothing pending, rather than erroring', async () => {
    const client = new FakeGraphClient();
    const discovery = new GraphSettlementDiscovery({
      sources: [{ chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT }],
      client,
      domainFor,
    });

    expect(await discovery.pendingSettlements()).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Sad paths
  // -----------------------------------------------------------------------

  /// A subgraph outage must surface as a thrown error, never as "nothing
  /// pending" — the latter reads as a quiet day rather than an outage, and
  /// settlement would silently stop advancing while attestations pile up.
  it('throws rather than returning an empty world when a query fails', async () => {
    const client = new FakeGraphClient();
    client.failWith.set(SEPOLIA_ENDPOINT, new Error('subgraph unreachable'));

    const discovery = new GraphSettlementDiscovery({
      sources: [{ chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT }],
      client,
      domainFor,
    });

    await expect(discovery.pendingSettlements()).rejects.toThrow('subgraph unreachable');
  });

  it('one chain failing fails the whole discovery, not just that chain', async () => {
    const client = new FakeGraphClient();
    client.responses.set(ARC_ENDPOINT, [rawIntent(1)]);
    client.failWith.set(SEPOLIA_ENDPOINT, new Error('subgraph unreachable'));

    const discovery = new GraphSettlementDiscovery({
      sources: [
        { chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT },
        { chainId: ARC, endpoint: ARC_ENDPOINT },
      ],
      client,
      domainFor,
    });

    // A partial merge here would silently under-track settlements on the
    // chain that failed, which is worse than refusing to act this tick.
    await expect(discovery.pendingSettlements()).rejects.toThrow();
  });
});
