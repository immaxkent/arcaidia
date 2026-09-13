import { describe, expect, it, vi } from 'vitest';
import { FetchNestQueryClient } from '../src/observation/nest-client.js';

function responses(...statuses: number[]) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    calls.push(url);
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? JSON.stringify({ rows: [{ ok: 1 }], count: 1, ready: true, last_poll_unixtime: 5 }) : JSON.stringify({ error: 'server busy' }), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('FetchNestQueryClient retries the Nest\'s concurrency cap', () => {
  it('retries a 503 on /sql and on /ready, succeeding when the Nest answers', async () => {
    const { fetchImpl, calls } = responses(503, 200, 503, 503, 200);
    const client = new FetchNestQueryClient(fetchImpl);
    expect((await client.query('https://nest.local/x', 'SELECT 1')).rows).toEqual([{ ok: 1 }]);
    expect(await client.ready('https://nest.local/x')).toEqual({ lastPollUnixtime: 5, ready: true });
    expect(calls).toHaveLength(5);
  });

  it('gives up after three attempts with the real status', async () => {
    const { fetchImpl } = responses(503, 503, 503);
    await expect(new FetchNestQueryClient(fetchImpl).query('https://nest.local/x', 'SELECT 1')).rejects.toThrow(/503/);
  });

  it('does not retry a 400 — that is a bad query, not load', async () => {
    const { fetchImpl, calls } = responses(400);
    await expect(new FetchNestQueryClient(fetchImpl).query('https://nest.local/x', 'SELECT zzz')).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1);
  });
});
