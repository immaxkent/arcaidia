import { describe, expect, it } from 'vitest';
import { VaultFlowsService } from '../../src/vault-flows/service.js';
import { ParticipantRegistry } from '../../src/participant-registry.js';
import type { NestQueryClient, NestQueryResult } from '../../src/nest-client.js';
import type { VaultFlowEvent, VaultFlowSource } from '../../src/vault-flows/types.js';

const KNOWN_VAULT = '0xc74e693938dfbf7c11b787ba27cdde4c0215aaf1' as const;
const STRANGER_VAULT = '0x753937137eb92871a6f3517514d4f1ee860e3fdf' as const;

class FakeNestClient implements NestQueryClient {
  constructor(private readonly participantRows: ReadonlyArray<{ vault: string }>) {}

  async query<T>(_endpoint: string, _sql: string): Promise<NestQueryResult<T>> {
    return {
      rows: this.participantRows as unknown as T[],
      count: this.participantRows.length,
      truncated: false,
      degraded: false,
    };
  }
}

class FakeVaultFlowSource implements VaultFlowSource {
  constructor(private readonly events: readonly VaultFlowEvent[]) {}
  async readVaultFlows(): Promise<readonly VaultFlowEvent[]> {
    return this.events;
  }
}

function deposit(vault: `0x${string}`, logIndex: number): VaultFlowEvent {
  return {
    kind: 'DEPOSIT',
    vault,
    sender: '0x538e5e9797fa86ee25e97289439b6a3aba0165b0',
    owner: '0x538e5e9797fa86ee25e97289439b6a3aba0165b0',
    assets: 1_000n,
    shares: 1_000n,
    txHash: '0xaa',
    blockNumber: 1,
    blockTimestamp: 1,
    logIndex,
  };
}

describe('VaultFlowsService', () => {
  it('returns only the requested vault\'s events, refreshing participants first', async () => {
    const registry = new ParticipantRegistry('https://nest.example/x', new FakeNestClient([{ vault: KNOWN_VAULT }]));
    const source = new FakeVaultFlowSource([deposit(KNOWN_VAULT, 0), deposit(KNOWN_VAULT, 1)]);
    const service = new VaultFlowsService(registry, source);

    const events = await service.vaultFlowsFor(KNOWN_VAULT);

    expect(events).toHaveLength(2);
    expect(events.every((e) => e.vault === KNOWN_VAULT)).toBe(true);
  });

  it("excludes a stranger's vault even though it is a real, valid ERC-4626 vault elsewhere", async () => {
    const registry = new ParticipantRegistry('https://nest.example/x', new FakeNestClient([{ vault: KNOWN_VAULT }]));
    const source = new FakeVaultFlowSource([deposit(STRANGER_VAULT, 0)]);
    const service = new VaultFlowsService(registry, source);

    const events = await service.vaultFlowsFor(STRANGER_VAULT);

    expect(events).toEqual([]);
  });

  it('reflects the registry\'s current participant set, not one cached at construction', async () => {
    const source = new FakeVaultFlowSource([deposit(KNOWN_VAULT, 0)]);

    const beforeJoining = new VaultFlowsService(
      new ParticipantRegistry('https://nest.example/x', new FakeNestClient([])),
      source,
    );
    expect(await beforeJoining.vaultFlowsFor(KNOWN_VAULT)).toEqual([]);

    const afterJoining = new VaultFlowsService(
      new ParticipantRegistry('https://nest.example/x', new FakeNestClient([{ vault: KNOWN_VAULT }])),
      source,
    );
    expect(await afterJoining.vaultFlowsFor(KNOWN_VAULT)).toHaveLength(1);
  });

  it('returns an empty array for a vault with no events at all', async () => {
    const registry = new ParticipantRegistry('https://nest.example/x', new FakeNestClient([{ vault: KNOWN_VAULT }]));
    const source = new FakeVaultFlowSource([]);
    const service = new VaultFlowsService(registry, source);

    expect(await service.vaultFlowsFor(KNOWN_VAULT)).toEqual([]);
  });
});
