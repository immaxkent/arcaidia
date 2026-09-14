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
    const client = new FetchNestQueryClient(fetchImpl, { attempts: 3, delayMs: 5 });
    expect((await client.query('https://nest.local/x', 'SELECT 1')).rows).toEqual([{ ok: 1 }]);
    expect(await client.ready('https://nest.local/x')).toEqual({ lastPollUnixtime: 5, ready: true });
    expect(calls).toHaveLength(5);
  });

  it('gives up after three attempts with the real status', async () => {
    const { fetchImpl } = responses(503, 503, 503);
    await expect(new FetchNestQueryClient(fetchImpl, { attempts: 3, delayMs: 5 }).query('https://nest.local/x', 'SELECT 1')).rejects.toThrow(/503/);
  });

  it('does not retry a 400 — that is a bad query, not load', async () => {
    const { fetchImpl, calls } = responses(400);
    await expect(new FetchNestQueryClient(fetchImpl, { attempts: 3, delayMs: 5 }).query('https://nest.local/x', 'SELECT zzz')).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1);
  });
});

describe('FetchNestQueryClient.ready and a stalled seal', () => {
  it('treats a 503 whose body shows a fresh tip behind a stalled seal as ready', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ready: false, stalled: true, tip_seal_stalled: true, lag_blocks: 0, seconds_since_poll: 7, last_poll_unixtime: 99 }), { status: 503 }),
    ) as unknown as typeof fetch;
    expect(await new FetchNestQueryClient(fetchImpl, { attempts: 3, delayMs: 5 }).ready('https://nest.local/x')).toEqual({ lastPollUnixtime: 99, ready: true });
  });

  it('still refuses a 503 whose tip is stale or lagging', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ready: false, stalled: true, lag_blocks: 40, seconds_since_poll: 900 }), { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(new FetchNestQueryClient(fetchImpl, { attempts: 3, delayMs: 5 }).ready('https://nest.local/x')).rejects.toThrow(/503/);
  });
});
