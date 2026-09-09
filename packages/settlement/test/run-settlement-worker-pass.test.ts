import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemorySettlementJournal,
  MockSettlementAdapter,
  runSettlementWorkerPass,
  type SettlementRecord,
  type SettlementWorkerDependencies,
} from '../src/index.js';
import type { SettlementDiscoveryProvider } from '../src/observation/discover-settlements.js';
import { ARC, SEPOLIA, TestClock, USDC, mirroredReference, reference } from './fixtures.js';
import { FakeReceiverClient } from './worker-fakes.js';

const DELAY = 120;
const ARC_RECEIVER = '0x6666666666666666666666666666666666666666' as const;
const SEPOLIA_RECEIVER = '0x3333333333333333333333333333333333333333' as const;
const RECIPIENT = '0x2222222222222222222222222222222222222222' as const;

/** Hands back whatever the test sets, or throws whatever the test sets. */
class FakeDiscovery implements SettlementDiscoveryProvider {
  records: SettlementRecord[] = [];
  failWith: Error | null = null;
  callCount = 0;

  async pendingSettlements(): Promise<readonly SettlementRecord[]> {
    this.callCount += 1;
    if (this.failWith) throw this.failWith;
    return this.records;
  }
}

const record = (seed: number, mirrored = false): SettlementRecord => ({
  reference: mirrored ? mirroredReference(seed) : reference(seed),
  amount: USDC(1_000),
  fallbackRecipient: RECIPIENT,
});

describe('runSettlementWorkerPass', () => {
  let clock: TestClock;
  let adapter: MockSettlementAdapter;
  let receiverClient: FakeReceiverClient;
  let journal: InMemorySettlementJournal;
  let discovery: FakeDiscovery;
  let deps: SettlementWorkerDependencies;

  beforeEach(() => {
    clock = new TestClock();
    adapter = new MockSettlementAdapter({ attestationDelaySeconds: DELAY, clock: clock.now });
    receiverClient = new FakeReceiverClient();
    journal = new InMemorySettlementJournal();
    discovery = new FakeDiscovery();

    deps = {
      adapter,
      receivers: new Map([
        [ARC, ARC_RECEIVER],
        [SEPOLIA, SEPOLIA_RECEIVER],
      ]),
      receiverClient,
      journal,
      clock: clock.now,
      discovery,
      registrar: adapter,
    };
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('tracks a newly discovered record in the journal and the adapter', async () => {
    discovery.records = [record(1)];

    const result = await runSettlementWorkerPass(deps);

    expect(result.kind).toBe('RAN');
    expect(journal.all()).toHaveLength(1);
    // Registered with the adapter, not just added to the journal — status()
    // would throw "No settlement registered" otherwise.
    await expect(adapter.status(record(1).reference)).resolves.toBeDefined();
  });

  it('reports how many records were newly tracked this pass', async () => {
    discovery.records = [record(1), record(2, true)];

    const result = await runSettlementWorkerPass(deps);

    expect(result.kind).toBe('RAN');
    if (result.kind === 'RAN') expect(result.newlyTracked).toBe(2);
  });

  it('advances a discovered record in the same pass it was found', async () => {
    discovery.records = [record(1)];
    clock.advance(DELAY);

    const result = await runSettlementWorkerPass(deps);

    expect(result.kind).toBe('RAN');
    if (result.kind === 'RAN') {
      expect(result.outcomes.get(record(1).reference.intentId)?.kind).toBe('SETTLED');
    }
  });

  it('does not re-register or re-add a record already known to the journal', async () => {
    discovery.records = [record(1)];
    await runSettlementWorkerPass(deps);
    expect(journal.all()).toHaveLength(1);

    // Same record offered again next tick, as a real discovery poll would.
    const result = await runSettlementWorkerPass(deps);

    expect(journal.all()).toHaveLength(1);
    if (result.kind === 'RAN') expect(result.newlyTracked).toBe(0);
  });

  it('a record already marked settled in a prior tick is not re-tracked either', async () => {
    discovery.records = [record(1)];
    await runSettlementWorkerPass(deps);
    clock.advance(DELAY);
    await runSettlementWorkerPass(deps); // completes it
    expect(journal.isSettled(record(1).reference.intentId)).toBe(true);

    const result = await runSettlementWorkerPass(deps);

    expect(journal.all()).toHaveLength(1);
    if (result.kind === 'RAN') expect(result.newlyTracked).toBe(0);
  });

  it('an empty discovery result still runs a pass over what the journal already has', async () => {
    discovery.records = [record(1)];
    await runSettlementWorkerPass(deps); // tracks it

    discovery.records = []; // nothing new this tick
    clock.advance(DELAY);
    const result = await runSettlementWorkerPass(deps);

    expect(result.kind).toBe('RAN');
    if (result.kind === 'RAN') {
      expect(result.newlyTracked).toBe(0);
      expect(result.outcomes.get(record(1).reference.intentId)?.kind).toBe('SETTLED');
    }
  });

  // -----------------------------------------------------------------------
  // Sad paths
  // -----------------------------------------------------------------------

  it('discovery failing reports DISCOVERY_FAILED and processes nothing', async () => {
    discovery.failWith = new Error('subgraph unreachable');

    const result = await runSettlementWorkerPass(deps);

    expect(result.kind).toBe('DISCOVERY_FAILED');
    if (result.kind === 'DISCOVERY_FAILED') expect(result.error.message).toBe('subgraph unreachable');
    expect(journal.all()).toHaveLength(0);
  });

  it('discovery failing does not stop already-tracked records from advancing on the next call', async () => {
    discovery.records = [record(1)];
    await runSettlementWorkerPass(deps);

    discovery.failWith = new Error('subgraph unreachable');
    const failed = await runSettlementWorkerPass(deps);
    expect(failed.kind).toBe('DISCOVERY_FAILED');

    discovery.failWith = null;
    clock.advance(DELAY);
    const recovered = await runSettlementWorkerPass(deps);

    expect(recovered.kind).toBe('RAN');
    if (recovered.kind === 'RAN') {
      expect(recovered.outcomes.get(record(1).reference.intentId)?.kind).toBe('SETTLED');
    }
  });
});
