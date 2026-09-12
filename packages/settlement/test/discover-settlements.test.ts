import { describe, expect, it } from 'vitest';
import { encodeIntentHook } from '@arcaidia/domain';
import { GraphSettlementDiscovery, NestSettlementDiscovery, type GraphQueryClient, type NestQueryClient, type NestQueryResult } from '../src/index.js';
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
  intentVersion?: number;
  tokenOut?: string;
  targetMinOut?: string;
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

  /// D8: a v2 row (the router stamped `intentVersion`) carries the exact hook its CCTP message
  /// holds, so the adapter knows to complete through `settleWithProof`; a v1 row does not.
  it('attaches the intent hook to v2 rows and leaves v1 rows hookless', async () => {
    const client = new FakeGraphClient();
    client.responses.set(SEPOLIA_ENDPOINT, [
      rawIntent(7, { intentVersion: 1, tokenOut: '0x0000000000000000000000000000000000000000', targetMinOut: '0' }),
      rawIntent(8),
    ]);
    const discovery = new GraphSettlementDiscovery({
      sources: [{ chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT }],
      client,
      domainFor,
    });

    const [v2, v1] = await discovery.pendingSettlements();

    expect(v2!.reference.hookData).toBe(
      encodeIntentHook({ intentId: rawIntent(7).id as `0x${string}`, recipient: rawIntent(7).recipient as `0x${string}` }),
    );
    expect(v1!.reference.hookData).toBeUndefined();
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

/** Returns canned `intents` rows per endpoint, in the Nest's own snake_case; throws when told to. */
class FakeNestClient implements NestQueryClient {
  readonly calls: Array<{ endpoint: string; sql: string }> = [];
  responses = new Map<string, Record<string, unknown>[]>();
  failWith = new Map<string, Error>();
  flags: Partial<Pick<NestQueryResult<unknown>, 'truncated' | 'degraded'>> = {};

  async query<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>> {
    this.calls.push({ endpoint, sql });
    const failure = this.failWith.get(endpoint);
    if (failure) throw failure;
    const rows = (this.responses.get(endpoint) ?? []) as T[];
    return { rows, count: rows.length, truncated: this.flags.truncated ?? false, degraded: this.flags.degraded ?? false };
  }
}

function nestRow(seed: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const raw = rawIntent(seed);
  return {
    id: raw.id,
    recipient: raw.recipient,
    amount: raw.amount,
    source_chain_id: raw.sourceChainId,
    destination_chain_id: raw.destinationChainId,
    intent_version: 1,
    token_out: '0x0000000000000000000000000000000000000000',
    target_min_out: '0',
    settlement_ref: raw.settlementRef,
    created_at_timestamp: raw.createdAtTimestamp,
    created_tx_hash: raw.createdTxHash,
    ...overrides,
  };
}

describe('NestSettlementDiscovery', () => {
  it('asks each chain for canonically-pending intents and maps the Nest row to the same record the Graph path produces', async () => {
    const client = new FakeNestClient();
    client.responses.set(SEPOLIA_ENDPOINT, [nestRow(1)]);
    const discovery = new NestSettlementDiscovery({
      sources: [
        { chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT },
        { chainId: ARC, endpoint: ARC_ENDPOINT },
      ],
      client,
      domainFor,
    });

    const records = await discovery.pendingSettlements();

    expect(client.calls.map((c) => c.endpoint)).toEqual([SEPOLIA_ENDPOINT, ARC_ENDPOINT]);
    expect(client.calls[0]!.sql).toContain("FROM intents WHERE canonical_status = 'PENDING'");
    expect(records).toHaveLength(1);
    const raw = rawIntent(1);
    expect(records[0]).toEqual({
      reference: {
        intentId: raw.id,
        sourceChainId: SEPOLIA,
        destinationChainId: ARC,
        sourceDomain: 0,
        destinationDomain: 26,
        sourceTxHash: raw.createdTxHash,
        messageRef: raw.settlementRef,
        initiatedAt: 1_800_000_000,
        hookData: encodeIntentHook({ intentId: raw.id as `0x${string}`, recipient: raw.recipient as `0x${string}` }),
      },
      amount: USDC(1_000),
      fallbackRecipient: raw.recipient,
    });
  });

  it('leaves hookData off a v1 row (no intent_version), so it settles by the reporter path', async () => {
    const client = new FakeNestClient();
    client.responses.set(ARC_ENDPOINT, [nestRow(2, { intent_version: null })]);
    const discovery = new NestSettlementDiscovery({ sources: [{ chainId: ARC, endpoint: ARC_ENDPOINT }], client, domainFor });
    const [record] = await discovery.pendingSettlements();
    expect(record!.reference).not.toHaveProperty('hookData');
  });

  it('throws rather than returning an empty world when a Nest is down, truncated or degraded', async () => {
    const down = new FakeNestClient();
    down.failWith.set(SEPOLIA_ENDPOINT, new Error('503 busy'));
    await expect(
      new NestSettlementDiscovery({ sources: [{ chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT }], client: down, domainFor }).pendingSettlements(),
    ).rejects.toThrow('503 busy');

    const truncated = new FakeNestClient();
    truncated.flags = { truncated: true };
    await expect(
      new NestSettlementDiscovery({ sources: [{ chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT }], client: truncated, domainFor }).pendingSettlements(),
    ).rejects.toThrow(/truncated/);

    const degraded = new FakeNestClient();
    degraded.flags = { degraded: true };
    await expect(
      new NestSettlementDiscovery({ sources: [{ chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT }], client: degraded, domainFor }).pendingSettlements(),
    ).rejects.toThrow(/degraded/);
  });
});
