import { describe, expect, it } from 'vitest';
import {
  SqlNestObservationProvider,
  type EvmContractReadClient,
  type NestQueryClient,
  type NestQueryResult,
} from '../src/index.js';
import { ARC, NOW, SEPOLIA, USDC } from './fixtures.js';

const SEPOLIA_ENDPOINT = 'https://example.invalid/arcaidia-sepolia';
const ARC_ENDPOINT = 'https://example.invalid/arcaidia-arc';
const VAULT = '0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1';
const ASSET_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const ASSET_ARC = '0x3600000000000000000000000000000000000000';

/** Serves canned rows per endpoint+table, and records every query asked. */
class FakeNest implements NestQueryClient {
  calls: Array<{ endpoint: string; sql: string }> = [];
  failWith: Error | null = null;
  degraded = false;
  truncated = false;

  private readonly rows = new Map<string, Map<string, unknown[]>>();
  private readonly readyResponses = new Map<string, { lastPollUnixtime: number; ready: boolean }>();

  setRows(endpoint: string, table: string, rows: unknown[]): void {
    const forEndpoint = this.rows.get(endpoint) ?? new Map<string, unknown[]>();
    forEndpoint.set(table, rows);
    this.rows.set(endpoint, forEndpoint);
  }

  setReady(endpoint: string, lastPollUnixtime: number, ready = true): void {
    this.readyResponses.set(endpoint, { lastPollUnixtime, ready });
  }

  async query<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>> {
    this.calls.push({ endpoint, sql });
    if (this.failWith) throw this.failWith;

    const table = this.tableFor(sql);
    const rows = (this.rows.get(endpoint)?.get(table) ?? []) as T[];
    return { rows, count: rows.length, truncated: this.truncated, degraded: this.degraded };
  }

  async ready(endpoint: string): Promise<{ lastPollUnixtime: number; ready: boolean }> {
    if (this.failWith) throw this.failWith;
    return this.readyResponses.get(endpoint) ?? { lastPollUnixtime: NOW, ready: true };
  }

  private tableFor(sql: string): string {
    if (sql.includes('FROM pending_intents')) return 'pending_intents';
    if (sql.includes('FROM intent_router__intent_created')) return 'intent_router__intent_created';
    if (sql.includes('FROM fills')) return 'fills';
    if (sql.includes('FROM vault')) return 'vault';
    if (sql.includes('FROM protocol_state')) return 'protocol_state';
    if (sql.includes('FROM intents WHERE fast_status')) return 'intents';
    throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
  }
}

class FakeContractReads implements EvmContractReadClient {
  private readonly overrides = new Map<string, bigint>();

  constructor(
    private readonly defaults: Record<string, unknown> = {
      reserveFloor: USDC(10_000),
      maxFillAmount: USDC(25_000),
      maxOutstandingExposure: USDC(60_000),
      totalSupply: USDC(100_000),
      // The v2 vault's immutable policy (7-tuple, as viem returns the struct getter) + live tier.
      feePolicy: [10, 25, 60, 120, 5_000, 7_500, 9_000],
      currentFeeBps: 10,
    },
  ) {}

  set(functionName: string, value: bigint): void {
    this.overrides.set(functionName, value);
  }

  async readContract(args: { functionName: string }): Promise<unknown> {
    if (this.overrides.has(args.functionName)) return this.overrides.get(args.functionName);
    const key = args.functionName as keyof typeof this.defaults;
    if (key in this.defaults) return this.defaults[key];
    throw new Error(`unexpected readContract call: ${args.functionName}`);
  }
}

const rawIntent = (overrides: Record<string, unknown> = {}) => ({
  id: '0x'.padEnd(66, 'a'),
  sender: '0x1111111111111111111111111111111111111111',
  recipient: '0x2222222222222222222222222222222222222222',
  input_token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  amount: '1000000000',
  source_chain_id: String(SEPOLIA),
  destination_chain_id: String(ARC),
  max_fee_bps: '100',
  deadline: String(NOW + 3600),
  intent_version: '1',
  token_out: '0x0000000000000000000000000000000000000000',
  target_min_out: '0',
  settlement_ref: '0x'.padEnd(66, 'c'),
  created_at_block: 100,
  created_at_timestamp: NOW - 60,
  created_tx_hash: '0x'.padEnd(66, 'b'),
  ...overrides,
});

const rawNonceRow = (intentId: string, nonce: string) => ({ intentId, nonce });

const rawVault = (overrides: Record<string, unknown> = {}) => ({
  id: VAULT.toLowerCase(),
  liquid_balance: '100000000000',
  outstanding_exposure: '0',
  accrued_protocol_fees: '0',
  paused: false,
  updated_at_block: 500,
  ...overrides,
});

function provider(
  nest: FakeNest,
  reads: { sepolia?: FakeContractReads; arc?: FakeContractReads } = {},
): SqlNestObservationProvider {
  return new SqlNestObservationProvider({
    sources: [
      { chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT, vault: VAULT, asset: ASSET_SEPOLIA },
      { chainId: ARC, endpoint: ARC_ENDPOINT, vault: VAULT, asset: ASSET_ARC },
    ],
    client: nest,
    readClients: new Map([
      [SEPOLIA, reads.sepolia ?? new FakeContractReads()],
      [ARC, reads.arc ?? new FakeContractReads()],
    ]),
    clock: () => NOW,
  });
}

describe('SqlNestObservationProvider', () => {
  // -----------------------------------------------------------------------
  // Discovery and the cross-chain merge
  // -----------------------------------------------------------------------

  it('queries every configured chain', async () => {
    const nest = new FakeNest();
    await provider(nest).pendingIntents();

    const endpoints = new Set(nest.calls.map((c) => c.endpoint));
    expect(endpoints).toContain(SEPOLIA_ENDPOINT);
    expect(endpoints).toContain(ARC_ENDPOINT);
  });

  it('returns intents discovered on either chain, decoded into the shared domain shape', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', [rawIntent()]);
    nest.setRows(SEPOLIA_ENDPOINT, 'intent_router__intent_created', [rawNonceRow('0x'.padEnd(66, 'a'), '7')]);

    const [decoded] = await provider(nest).pendingIntents();
    expect(decoded).toMatchObject({
      amount: USDC(1_000),
      sourceChainId: SEPOLIA,
      destinationChainId: ARC,
      nonce: 7n,
      maxFeeBps: 100,
    });
  });

  /// An intent is created on one chain and filled on the other, so a source
  /// endpoint cannot know its own intents have been filled. The merge is
  /// what stops the solver being handed work that is already done.
  it('excludes intents the other chain has already filled', async () => {
    const id = '0x'.padEnd(66, 'a');
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', [rawIntent({ id })]);
    nest.setRows(SEPOLIA_ENDPOINT, 'intent_router__intent_created', [rawNonceRow(id, '7')]);
    nest.setRows(ARC_ENDPOINT, 'fills', [{ intent_id: id }]);

    expect(await provider(nest).pendingIntents()).toHaveLength(0);
  });

  it('reports an intent as filled when either chain has a fill for it', async () => {
    const id = '0x'.padEnd(66, 'a') as `0x${string}`;
    const nest = new FakeNest();
    nest.setRows(ARC_ENDPOINT, 'fills', [{ intent_id: id }]);

    expect(await provider(nest).isFilled(id)).toBe(true);
  });

  it('reports not filled when neither chain has a matching fill', async () => {
    const nest = new FakeNest();
    expect(await provider(nest).isFilled('0x'.padEnd(66, 'a') as `0x${string}`)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Batching — the actual point of this provider existing (WP-22)
  // -----------------------------------------------------------------------

  it('checks fills for every candidate in one query per chain, not one per candidate', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', [
      rawIntent({ id: '0x'.padEnd(66, '1') }),
      rawIntent({ id: '0x'.padEnd(66, '2') }),
      rawIntent({ id: '0x'.padEnd(66, '3') }),
    ]);
    nest.setRows(SEPOLIA_ENDPOINT, 'intent_router__intent_created', [
      rawNonceRow('0x'.padEnd(66, '1'), '1'),
      rawNonceRow('0x'.padEnd(66, '2'), '2'),
      rawNonceRow('0x'.padEnd(66, '3'), '3'),
    ]);

    await provider(nest).pendingIntents();

    const fillsCalls = nest.calls.filter((c) => c.sql.includes('FROM fills'));
    // One per chain (2), regardless of the 3 candidates found.
    expect(fillsCalls).toHaveLength(2);
  });

  it('issues no fill-check or nonce-lookup query when there are no candidates', async () => {
    const nest = new FakeNest();
    await provider(nest).pendingIntents();

    expect(nest.calls.some((c) => c.sql.includes('FROM fills'))).toBe(false);
    expect(nest.calls.some((c) => c.sql.includes('intent_created'))).toBe(false);
  });

  // -----------------------------------------------------------------------
  // The nonce workaround (see the provider's own doc comment)
  // -----------------------------------------------------------------------

  it("fills in nonce from the raw event table, since pending_intents' own nonce column is broken", async () => {
    const id = '0x'.padEnd(66, 'a');
    const nest = new FakeNest();
    // pending_intents itself returns no usable nonce — the provider never
    // even reads a `nonce` column from that row; only from the raw table.
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', [rawIntent({ id })]);
    nest.setRows(SEPOLIA_ENDPOINT, 'intent_router__intent_created', [
      rawNonceRow(id, '70894471100939239840431604398809328077424348488603401848314667881763225634802'),
    ]);

    const [decoded] = await provider(nest).pendingIntents();
    expect(decoded?.nonce).toBe(70894471100939239840431604398809328077424348488603401848314667881763225634802n);
  });

  it('throws rather than silently defaulting a nonce it could not find', async () => {
    const id = '0x'.padEnd(66, 'a');
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', [rawIntent({ id })]);
    nest.setRows(SEPOLIA_ENDPOINT, 'intent_router__intent_created', []); // the workaround query found nothing

    await expect(provider(nest).pendingIntents()).rejects.toThrow(/No nonce found/);
  });

  // -----------------------------------------------------------------------
  // Truncation and degradation — never silently report a partial world
  // -----------------------------------------------------------------------

  it('refuses a truncated pending_intents result rather than silently returning a partial list', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', [rawIntent()]);
    nest.truncated = true;

    await expect(provider(nest).pendingIntents()).rejects.toThrow(/truncated/);
  });

  it('refuses a degraded pending_intents result', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', [rawIntent()]);
    nest.degraded = true;

    await expect(provider(nest).pendingIntents()).rejects.toThrow(/degraded/);
  });

  // -----------------------------------------------------------------------
  // Vault state and staleness
  // -----------------------------------------------------------------------

  it('carries vault figures through unchanged, and the asset address it was given, not the vault address', async () => {
    const nest = new FakeNest();
    nest.setRows(
      ARC_ENDPOINT,
      'vault',
      [rawVault({ liquid_balance: '90000000000', outstanding_exposure: '10000000000', accrued_protocol_fees: '500000' })],
    );

    const state = await provider(nest).vaultState(ARC);
    expect(state.totalBalance).toBe(USDC(90_000));
    expect(state.outstandingExposure).toBe(USDC(10_000));
    expect(state.accruedProtocolFees).toBe(500_000n);
    expect(state.asset.toLowerCase()).toBe(ASSET_ARC.toLowerCase());
    expect(state.asset.toLowerCase()).not.toBe(VAULT.toLowerCase());
  });

  it("takes observedAt from the Nest's own /ready freshness, not the local clock or the row's own timestamp", async () => {
    const nest = new FakeNest();
    nest.setRows(ARC_ENDPOINT, 'vault', [rawVault()]);
    nest.setReady(ARC_ENDPOINT, NOW - 3_600);

    const state = await provider(nest).vaultState(ARC);
    expect(state.observedAt).toBe(NOW - 3_600);
  });

  it('reads reserveFloor, maxFillAmount and maxOutstandingExposure directly from the chain', async () => {
    const nest = new FakeNest();
    nest.setRows(ARC_ENDPOINT, 'vault', [rawVault()]);

    const reads = new FakeContractReads();
    reads.set('reserveFloor', USDC(5_000));
    reads.set('maxFillAmount', USDC(12_000));
    reads.set('maxOutstandingExposure', USDC(30_000));

    const state = await provider(nest, { arc: reads }).vaultState(ARC);
    expect(state.reserveFloor).toBe(USDC(5_000));
    expect(state.maxFillAmount).toBe(USDC(12_000));
    expect(state.maxOutstandingExposure).toBe(USDC(30_000));
  });

  it('refuses rather than inventing an unindexed vault', async () => {
    await expect(provider(new FakeNest()).vaultState(ARC)).rejects.toThrow(/No indexed vault/);
  });

  it('refuses a chain it has no Nest endpoint for', async () => {
    await expect(provider(new FakeNest()).vaultState(999)).rejects.toThrow(/No Nest endpoint configured/);
  });

  // -----------------------------------------------------------------------
  // Settlement health
  // -----------------------------------------------------------------------

  it('sums pending settlement value across chains', async () => {
    const nest = new FakeNest();
    const state = { intents_filled: 1, intents_settled: 0 };
    nest.setRows(SEPOLIA_ENDPOINT, 'protocol_state', [
      { ...state, pending_settlement_value: '1000000000', oldest_unsettled_timestamp: NOW - 100 },
    ]);
    nest.setRows(ARC_ENDPOINT, 'protocol_state', [
      { ...state, pending_settlement_value: '2000000000', oldest_unsettled_timestamp: NOW - 500 },
    ]);

    const health = await provider(nest).settlementHealth();
    expect(health.pendingValue).toBe(USDC(3_000));
    expect(health.oldestUnsettledAgeSeconds).toBe(500);
  });

  it('reports no outstanding age when nothing is pending', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'protocol_state', [
      { intents_filled: 0, intents_settled: 0, pending_settlement_value: '0', oldest_unsettled_timestamp: 0 },
    ]);

    expect((await provider(nest).settlementHealth()).oldestUnsettledAgeSeconds).toBeNull();
  });

  it('does not claim to know the canonical transport is healthy or not', async () => {
    const health = await provider(new FakeNest()).settlementHealth();
    expect(health.transport).toBe('HEALTHY');
    expect(health.averageSettlementLatencySeconds).toBeNull();
    expect(health.latencySampleSize).toBe(0);
  });

  // -----------------------------------------------------------------------
  // When the Nest is down
  // -----------------------------------------------------------------------

  it('throws rather than reporting an empty world', async () => {
    const nest = new FakeNest();
    nest.failWith = new Error('502 Bad Gateway');

    await expect(provider(nest).pendingIntents()).rejects.toThrow(/502/);
    await expect(provider(nest).vaultState(ARC)).rejects.toThrow(/502/);
    await expect(provider(nest).settlementHealth()).rejects.toThrow(/502/);
    await expect(provider(nest).isFilled('0x'.padEnd(66, 'a') as `0x${string}`)).rejects.toThrow();
  });

  it('recovers once the endpoint returns', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', [rawIntent()]);
    nest.setRows(SEPOLIA_ENDPOINT, 'intent_router__intent_created', [rawNonceRow('0x'.padEnd(66, 'a'), '1')]);

    nest.failWith = new Error('down');
    await expect(provider(nest).pendingIntents()).rejects.toThrow();

    nest.failWith = null;
    expect(await provider(nest).pendingIntents()).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // SQL construction safety
  // -----------------------------------------------------------------------

  it('refuses to build a query from a malformed intent id rather than interpolating it unchecked', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', [rawIntent({ id: "0xnothex'; DROP TABLE vault; --" })]);

    await expect(provider(nest).pendingIntents()).rejects.toThrow(/non-hex32/);
  });
});

// ---------------------------------------------------------------------------
// Settled-on-chain filter (2026-09-13): the Nest's "pending" rows lag the receiver
// ---------------------------------------------------------------------------

describe('settled-on-chain filter', () => {
  const RECEIVER = '0xa60c586E4d050233885cD6628B7C1A217574d9c6' as const;
  const RETIRED = '0x8B93b54d6Df61E9422D14C309F3c9Ab950b920Cd' as const;
  const OPEN = `0x${'a'.repeat(64)}`;
  const SETTLED = `0x${'b'.repeat(64)}`;

  class OutcomeReads extends FakeContractReads {
    outcomeCalls = 0;
    constructor(
      private readonly outcomes: Record<string, number>,
      private readonly retiredOutcomes: Record<string, number> = {},
    ) {
      super();
    }
    override async readContract(args: { address?: string; functionName: string; args?: readonly unknown[] }): Promise<unknown> {
      if (args.functionName === 'outcomeOf') {
        this.outcomeCalls += 1;
        const table = args.address === RETIRED ? this.retiredOutcomes : this.outcomes;
        return BigInt(table[String(args.args?.[0]).toLowerCase()] ?? 0);
      }
      return super.readContract(args);
    }
  }

  function chainChecked(nest: FakeNest, arc: OutcomeReads): SqlNestObservationProvider {
    return new SqlNestObservationProvider({
      sources: [
        { chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT, vault: VAULT, asset: ASSET_SEPOLIA },
        { chainId: ARC, endpoint: ARC_ENDPOINT, vault: VAULT, asset: ASSET_ARC },
      ],
      client: nest,
      readClients: new Map([
        [SEPOLIA, new FakeContractReads()],
        [ARC, arc],
      ]),
      clock: () => NOW,
      settlementReceivers: new Map<number, readonly `0x${string}`[]>([
        [SEPOLIA, [RECEIVER, RETIRED]],
        [ARC, [RECEIVER, RETIRED]],
      ]),
    });
  }

  it('settlement health counts only intents the destination receiver still reports NONE', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'intents', [
      { id: SETTLED, destination_chain_id: ARC, amount: '20000000', created_at_timestamp: NOW - 41_590 },
      { id: OPEN, destination_chain_id: ARC, amount: '3000000000', created_at_timestamp: NOW - 500 },
    ]);
    const arc = new OutcomeReads({ [SETTLED]: 2 });
    const health = await chainChecked(nest, arc).settlementHealth();
    expect(health.pendingValue).toBe(USDC(3_000));
    expect(health.oldestUnsettledAgeSeconds).toBe(500);
    // SETTLED: one read (live receiver answered); OPEN: live then retired, both NONE.
    expect(arc.outcomeCalls).toBe(3);
  });

  it('treats an intent settled on a retired receiver (D12) as settled', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'intents', [
      { id: SETTLED, destination_chain_id: ARC, amount: '20000000', created_at_timestamp: NOW - 41_590 },
    ]);
    const arc = new OutcomeReads({}, { [SETTLED]: 1 });
    const health = await chainChecked(nest, arc).settlementHealth();
    expect(health.pendingValue).toBe(0n);
    expect(health.oldestUnsettledAgeSeconds).toBeNull();
  });

  it('never offers an intent the receiver already settled, and remembers settled outcomes', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', [
      rawIntent({ id: OPEN, source_chain_id: SEPOLIA, destination_chain_id: ARC }),
      rawIntent({ id: SETTLED, source_chain_id: SEPOLIA, destination_chain_id: ARC }),
    ]);
    nest.setRows(SEPOLIA_ENDPOINT, 'intent_router__intent_created', [rawNonceRow(OPEN, '1'), rawNonceRow(SETTLED, '2')]);
    const arc = new OutcomeReads({ [SETTLED]: 1 });
    const provider = chainChecked(nest, arc);
    const offered = await provider.pendingIntents();
    expect(offered.map((i) => i.intentId)).toEqual([OPEN]);
    // Settled is final and cached; the open one is trusted for a minute — no new reads either way.
    await provider.pendingIntents();
    expect(arc.outcomeCalls).toBe(3);
  });

  it('keeps the Nest row when the receiver read fails', async () => {
    const nest = new FakeNest();
    nest.setRows(SEPOLIA_ENDPOINT, 'intents', [{ id: OPEN, destination_chain_id: ARC, amount: '1000000', created_at_timestamp: NOW - 10 }]);
    const failing = new OutcomeReads({});
    failing.readContract = async () => {
      throw new Error('rpc down');
    };
    const health = await chainChecked(nest, failing).settlementHealth();
    expect(health.pendingValue).toBe(1_000_000n);
  });
});

describe('Nest query size (16 KB cap)', () => {
  it('splits the filled-intents lookup into chunks of at most 100 ids, each query under 16 KB', async () => {
    const nest = new FakeNest();
    const ids = Array.from({ length: 350 }, (_, i) => `0x${(i + 1).toString(16).padStart(64, '0')}`);
    nest.setRows(SEPOLIA_ENDPOINT, 'pending_intents', ids.map((id) => rawIntent({ id })));
    nest.setRows(SEPOLIA_ENDPOINT, 'intent_router__intent_created', ids.map((id) => ({ intentId: id, nonce: '1' })));
    await provider(nest).pendingIntents();
    const nonceQueries = nest.calls.filter((c) => /intent_router__intent_created WHERE intentId IN/.test(c.sql));
    expect(nonceQueries.length).toBeGreaterThanOrEqual(4);
    for (const q of nonceQueries) expect(Buffer.byteLength(q.sql, 'utf8')).toBeLessThan(16_384);
    const fillQueries = nest.calls.filter((c) => /FROM fills WHERE intent_id IN/.test(c.sql));
    expect(fillQueries.length).toBeGreaterThanOrEqual(4);
    for (const q of fillQueries) {
      expect(Buffer.byteLength(q.sql, 'utf8')).toBeLessThan(16_384);
      expect((q.sql.match(/0x[0-9a-f]{64}/g) ?? []).length).toBeLessThanOrEqual(100);
    }
  });
});
