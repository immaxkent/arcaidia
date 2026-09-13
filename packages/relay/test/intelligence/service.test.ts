import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NestQueryClient, NestQueryResult } from '../../src/nest-client.js';
import { IntelligenceService } from '../../src/intelligence/service.js';
import { RelayStore } from '../../src/store.js';
import { startRelayServer, type RelayServerHandle } from '../../src/server.js';

const SEPOLIA = 11_155_111;
const ARC = 5_042_002;
const SEP = 'https://nest.local/sepolia';
const ARCN = 'https://nest.local/arc';
const VAULT_B = '0x8c924ca38856f4fdb2e8f672fd0084689b1ee47b';
const INTENT = `0x${'d0'.repeat(32)}`;

/** Answers by (endpoint, table) — the SQL is matched on its FROM clause, the way the Nest is used. */
class FakeNest implements NestQueryClient {
  readonly calls: Array<{ endpoint: string; sql: string }> = [];
  tables = new Map<string, Record<string, unknown>[]>();
  failWith: Error | null = null;
  degradedOn: string | null = null;

  set(endpoint: string, table: string, rows: Record<string, unknown>[]) {
    this.tables.set(`${endpoint}|${table}`, rows);
  }

  async query<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>> {
    this.calls.push({ endpoint, sql });
    if (this.failWith) throw this.failWith;
    const table = /FROM (\w+)/.exec(sql)?.[1] ?? '';
    let rows = this.tables.get(`${endpoint}|${table}`) ?? [];
    // The two `intents` queries select different columns: the id join wants rows with an id.
    if (table === 'intents') rows = rows.filter((r) => (/WHERE id IN/.test(sql) ? 'id' in r : 'amount' in r));
    const typed = rows as T[];
    return { rows: typed, count: typed.length, truncated: false, degraded: this.degradedOn === endpoint };
  }
}

function seeded(): FakeNest {
  const nest = new FakeNest();
  const vaultRow = (id: string, liquid: string, fee: number) => ({
    id, liquid_balance: liquid, outstanding_exposure: '0', current_fee_bps: fee, reserve_floor_bps: '1000', max_fill_bps: '5000', max_exposure_bps: '8000', paused: false, updated_at_block: '61736000',
  });
  nest.set(ARCN, 'vaults', [vaultRow('0xb4ba190d5c78869366e7963f5cccf4c3167d855c', '120000000', 10), vaultRow(VAULT_B, '60000000', 15)]);
  nest.set(SEP, 'vaults', [{ ...vaultRow('0xb4ba190d5c78869366e7963f5cccf4c3167d855c', '120000000', 10), updated_at_block: '11690000' }]);
  nest.set(SEP, 'intents', [
    { source_chain_id: SEPOLIA, destination_chain_id: ARC, amount: '3780000', created_at_timestamp: 1_789_237_116 },
    // The row the latency join asks for by id:
    { id: INTENT, created_at_timestamp: 1_789_237_116 },
  ]);
  nest.set(ARCN, 'fills', [{ timestamp: 1_789_237_139 }]);
  nest.set(ARCN, 'settlements', [{ intent_id: INTENT, timestamp: 1_789_238_316 }]);
  return nest;
}

const sources = [
  { chainId: SEPOLIA, endpoint: SEP },
  { chainId: ARC, endpoint: ARCN },
];

describe('IntelligenceService', () => {
  it('computes the ecosystem view from the four Nest views, joining settlement latency across chains', async () => {
    const nest = seeded();
    const service = new IntelligenceService({ sources, client: nest, clock: () => 1_789_240_000 });
    const view = await service.ecosystem();
    expect(view.aggregateAvailableLiquidity).toBe(108_000_000n + 54_000_000n + 108_000_000n);
    expect(view.feeDistribution.perVault).toHaveLength(3);
    expect(view.outstandingIntentVolume).toBe(3_780_000n);
    expect(view.recentFillVelocityPerHour).toBe(1);
    // 1_789_238_316 − 1_789_237_116 = 1200s, joined from the Sepolia intents row.
    expect(view.recentSettlementLatency).toEqual({ p50Seconds: 1_200, p95Seconds: 1_200, sampleSize: 1 });
    expect(view.sourceBlocks).toEqual({ [SEPOLIA]: 11_690_000n, [ARC]: 61_736_000n });
    expect(nest.calls.find((c) => c.endpoint === SEP && /WHERE id IN/.test(c.sql))?.sql).toContain(INTENT);
  });

  it('serves every view from one cached fetch inside the cache window', async () => {
    const nest = seeded();
    let now = 1_789_240_000;
    const service = new IntelligenceService({ sources, client: nest, clock: () => now, cacheSeconds: 10 });
    await service.ecosystem();
    const calls = nest.calls.length;
    await service.chain(ARC);
    await service.vault(ARC, VAULT_B);
    await service.quoteContext(10_000_000n, ARC);
    expect(nest.calls.length).toBe(calls);
    now += 11;
    await service.ecosystem();
    expect(nest.calls.length).toBeGreaterThan(calls);
  });

  it('answers null for a chain or vault it does not serve', async () => {
    const service = new IntelligenceService({ sources, client: seeded(), clock: () => 1_789_240_000 });
    expect(await service.chain(1)).toBeNull();
    expect(await service.quoteContext(1n, 1)).toBeNull();
    expect(await service.vault(ARC, `0x${'99'.repeat(20)}`)).toBeNull();
  });

  it('throws — never a quiet zero — when a Nest is down or degraded', async () => {
    const down = seeded();
    down.failWith = new Error('503 busy');
    await expect(new IntelligenceService({ sources, client: down }).ecosystem()).rejects.toThrow('503 busy');
    const degraded = seeded();
    degraded.degradedOn = ARCN;
    await expect(new IntelligenceService({ sources, client: degraded }).ecosystem()).rejects.toThrow(/degraded/);
  });
});

describe('GET /v1/intelligence/*', () => {
  let handle: RelayServerHandle;
  let nest: FakeNest;
  const url = (path: string) => `http://127.0.0.1:${handle.port}${path}`;

  beforeEach(async () => {
    nest = seeded();
    const intelligence = new IntelligenceService({ sources, client: nest, clock: () => 1_789_240_000 });
    handle = await startRelayServer(new RelayStore({ clock: () => 1_789_240_000 }), { port: 0, host: '127.0.0.1', intelligence });
  });
  afterEach(async () => handle.close());

  it('serves the four views as JSON with bigints as decimal strings, CORS open', async () => {
    const eco = await fetch(url('/v1/intelligence/ecosystem'));
    expect(eco.status).toBe(200);
    expect(eco.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await eco.json()) as { aggregateAvailableLiquidity: string; sourceBlocks: Record<string, string> };
    expect(body.aggregateAvailableLiquidity).toBe('270000000');
    expect(body.sourceBlocks[String(ARC)]).toBe('61736000');

    const chain = (await (await fetch(url(`/v1/intelligence/chain/${ARC}`))).json()) as { chainId: number };
    expect(chain.chainId).toBe(ARC);

    const vault = (await (await fetch(url(`/v1/intelligence/vault/${ARC}/${VAULT_B}`))).json()) as { fillCapacity: string; feeRank: number };
    expect(vault).toMatchObject({ fillCapacity: '27000000', feeRank: 1 });

    const quote = (await (await fetch(url(`/v1/intelligence/quote-context?amount=10000000&destinationChainId=${ARC}`))).json()) as { vaultsAbleToFill: number; bestFeeBps: number };
    expect(quote).toMatchObject({ vaultsAbleToFill: 2, bestFeeBps: 10 });
  });

  it('404s an unknown chain or vault, 400s a malformed request, and never guesses', async () => {
    expect((await fetch(url('/v1/intelligence/chain/1'))).status).toBe(404);
    expect((await fetch(url(`/v1/intelligence/vault/${ARC}/0x1234`))).status).toBe(400);
    expect((await fetch(url('/v1/intelligence/quote-context?amount=abc&destinationChainId=1'))).status).toBe(400);
    expect((await fetch(url('/v1/intelligence/nothing'))).status).toBe(404);
  });

  it('503s with the reason when the Nest cannot answer, and when the service is not configured', async () => {
    nest.failWith = new Error('nest down');
    const res = await fetch(url('/v1/intelligence/ecosystem'));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('nest down');

    const bare = await startRelayServer(new RelayStore({ clock: () => 1 }), { port: 0, host: '127.0.0.1' });
    try {
      expect((await fetch(`http://127.0.0.1:${bare.port}/v1/intelligence/ecosystem`)).status).toBe(503);
    } finally {
      await bare.close();
    }
  });
});
