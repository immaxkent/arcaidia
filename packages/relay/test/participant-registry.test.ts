import { describe, expect, it } from 'vitest';
import { ParticipantRegistry } from '../src/participant-registry.js';
import type { NestQueryClient, NestQueryResult } from '../src/nest-client.js';

const ENDPOINT = 'https://nest.example/arcaidia-sepolia';

class FakeNestClient implements NestQueryClient {
  constructor(public rows: ReadonlyArray<{ vault: string }>) {}
  calls: string[] = [];

  async query<T>(endpoint: string, sql: string): Promise<NestQueryResult<T>> {
    this.calls.push(sql);
    expect(endpoint).toBe(ENDPOINT);
    return { rows: this.rows as unknown as T[], count: this.rows.length, truncated: false, degraded: false };
  }
}

describe('ParticipantRegistry', () => {
  it('starts with no known participants before a refresh', () => {
    const registry = new ParticipantRegistry(ENDPOINT, new FakeNestClient([]));
    expect(registry.participants().size).toBe(0);
    expect(registry.isParticipant('0xc74e693938dfbf7c11b787ba27cdde4c0215aaf1')).toBe(false);
  });

  it('derives the participant set from distinct fill vaults, lowercased', async () => {
    const client = new FakeNestClient([
      { vault: '0xC74E693938DfBf7c11b787bA27cddE4c0215AAF1' },
      { vault: '0x753937137eb92871a6f3517514d4f1ee860e3fdf' },
    ]);
    const registry = new ParticipantRegistry(ENDPOINT, client);

    await registry.refresh();

    expect(registry.isParticipant('0xc74e693938dfbf7c11b787ba27cdde4c0215aaf1')).toBe(true);
    expect(registry.isParticipant('0xC74E693938DfBf7c11b787bA27cddE4c0215AAF1')).toBe(true);
    expect(registry.isParticipant('0x93083f60f1877a6ba974d5ed88bb74943deb8390')).toBe(false);
    expect(client.calls).toEqual(['SELECT DISTINCT vault FROM fills']);
  });

  it('replaces, rather than merges, the participant set on a second refresh', async () => {
    const client = new FakeNestClient([{ vault: '0x753937137eb92871a6f3517514d4f1ee860e3fdf' }]);
    const registry = new ParticipantRegistry(ENDPOINT, client);

    await registry.refresh();
    expect(registry.participants().size).toBe(1);

    client.rows = [{ vault: '0x93083f60f1877a6ba974d5ed88bb74943deb8390' }] as unknown as { vault: string }[];
    await registry.refresh();

    expect(registry.isParticipant('0x753937137eb92871a6f3517514d4f1ee860e3fdf')).toBe(false);
    expect(registry.isParticipant('0x93083f60f1877a6ba974d5ed88bb74943deb8390')).toBe(true);
  });
});
