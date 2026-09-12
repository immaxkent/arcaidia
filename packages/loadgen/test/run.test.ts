import { describe, expect, it } from 'vitest';
import { DryRunSubmitter, runLoadgen, type JournalEntry, type LoadgenMetrics, type MarketObserver, type MarketSnapshot } from '../src/index.js';
import { defaultConfig } from './fixtures.js';

/** A virtual clock: `sleep` advances it instantly, so hours of traffic run in milliseconds. */
function virtualTime(start = 1_800_000_000) {
  let now = start;
  return { clock: () => now, sleep: async (s: number) => { now += s; } };
}

class ScriptedObserver implements MarketObserver {
  calls = 0;
  constructor(private readonly clock: () => number, private readonly liquidity: (at: number) => bigint) {}
  async snapshot(): Promise<MarketSnapshot> {
    this.calls++;
    const at = this.clock();
    return { at, vaults: [], aggregateAvailableLiquidity: this.liquidity(at), aggregateOutstandingExposure: 0n, intentsCreated: 10, intentsFilled: 8, intentsFallenBack: 2 };
  }
}

const base = (clock: () => number, sleep: (s: number) => Promise<void>, journal: JournalEntry[]) => ({
  config: defaultConfig(), clock, sleep, onJournal: (e: JournalEntry) => journal.push(e), onMetrics: () => {}, log: () => {},
});

describe('runLoadgen', () => {
  it('dry run: plans, journals and reports metrics without sending anything', async () => {
    const { clock, sleep } = virtualTime();
    const submitter = new DryRunSubmitter(clock);
    const journal: JournalEntry[] = [];
    let metrics: LoadgenMetrics | null = null;
    const summary = await runLoadgen({ ...base(clock, sleep, journal), submitter, observer: null, onMetrics: (m) => { metrics = m; }, totalSeconds: 3600 });
    expect(summary.phasesRun).toBeGreaterThan(2);
    expect(summary.intentsSubmitted).toBe(journal.length);
    expect(submitter.submitted.length).toBe(journal.length);
    expect(journal.every((e) => e.submitted !== null && e.error === null)).toBe(true);
    expect(metrics!.intentsPlanned).toBe(journal.length);
    expect(metrics!.market.aggregateAvailableLiquidity).toBeNull(); // no observer → nothing fabricated
  });

  it('round-robins the configured wallets per source chain', async () => {
    const { clock, sleep } = virtualTime();
    const journal: JournalEntry[] = [];
    await runLoadgen({ ...base(clock, sleep, journal), submitter: new DryRunSubmitter(clock), observer: null, totalSeconds: 3600 });
    expect([...new Set(journal.map((e) => e.walletIndex))].sort()).toEqual([0, 1]);
  });

  it('lightens the mix when the market is always constrained, and never turns traffic off', async () => {
    const { clock, sleep } = virtualTime();
    const observer = new ScriptedObserver(clock, () => 0n);
    const journal: JournalEntry[] = [];
    const summary = await runLoadgen({ ...base(clock, sleep, journal), submitter: new DryRunSubmitter(clock), observer, totalSeconds: 4 * 3600, observeEverySeconds: 30 });
    expect(observer.calls).toBeGreaterThan(50);
    expect(summary.finalMultiplier).toBeLessThan(1);
    expect(summary.finalMultiplier).toBeGreaterThanOrEqual(defaultConfig().scarcity.weightMultiplierBounds.min);
    expect(journal.length).toBeGreaterThan(0);
  });

  it('records a submission failure and keeps going', async () => {
    const { clock, sleep } = virtualTime();
    let n = 0;
    const flaky = { submit: async () => { n++; if (n % 3 === 0) throw new Error('rpc hiccup'); return { intentId: '0x1' as const, txHash: '0x2' as const, from: '0x0000000000000000000000000000000000000001' as const, nonce: BigInt(n), submittedAt: clock() }; } };
    const journal: JournalEntry[] = [];
    const summary = await runLoadgen({ ...base(clock, sleep, journal), submitter: flaky, observer: null, totalSeconds: 3600 });
    expect(journal.some((e) => e.error === 'rpc hiccup')).toBe(true);
    expect(summary.intentsSubmitted).toBeLessThan(summary.intentsPlanned);
    expect(summary.intentsSubmitted).toBeGreaterThan(0);
  });
});
