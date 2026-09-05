import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_POLICY,
  evaluateIntent,
} from '@arcaidia/agent';
import {
  InMemorySettlementJournal,
  deriveSettlementHealth,
  type SettlementRecord,
} from '../src/index.js';
import { NOW, USDC, reference } from './fixtures.js';

const RECIPIENT = '0x2222222222222222222222222222222222222222' as const;

function journalWith(records: SettlementRecord[]): InMemorySettlementJournal {
  const journal = new InMemorySettlementJournal();
  for (const record of records) journal.add(record);
  return journal;
}

const record = (seed: number, initiatedAt: number, amount = USDC(1_000)): SettlementRecord => ({
  reference: reference(seed, { initiatedAt }),
  amount,
  fallbackRecipient: RECIPIENT,
});

describe('deriveSettlementHealth', () => {
  it('reports nothing outstanding for an empty journal', () => {
    const health = deriveSettlementHealth(journalWith([]), 'HEALTHY', NOW);

    expect(health.pendingValue).toBe(0n);
    expect(health.oldestUnsettledAgeSeconds).toBeNull();
    expect(health.averageSettlementLatencySeconds).toBeNull();
    expect(health.latencySampleSize).toBe(0);
  });

  it('sums the value still in flight', () => {
    const journal = journalWith([
      record(1, NOW - 60, USDC(1_000)),
      record(2, NOW - 30, USDC(2_500)),
    ]);

    expect(deriveSettlementHealth(journal, 'HEALTHY', NOW).pendingValue).toBe(USDC(3_500));
  });

  it('reports the age of the oldest outstanding settlement', () => {
    const journal = journalWith([record(3, NOW - 600), record(4, NOW - 30)]);
    expect(deriveSettlementHealth(journal, 'HEALTHY', NOW).oldestUnsettledAgeSeconds).toBe(600);
  });

  /// Settled work must leave the backlog immediately, or the risk engine keeps
  /// pricing against exposure that no longer exists.
  it('excludes settled records from the backlog', () => {
    const journal = journalWith([record(5, NOW - 600), record(6, NOW - 30)]);
    journal.markSettled(reference(5, { initiatedAt: NOW - 600 }).intentId, NOW);

    const health = deriveSettlementHealth(journal, 'HEALTHY', NOW);
    expect(health.oldestUnsettledAgeSeconds).toBe(30);
    expect(health.pendingValue).toBe(USDC(1_000));
  });

  it('averages observed latency', () => {
    const journal = journalWith([record(7, NOW - 300), record(8, NOW - 200)]);
    journal.markSettled(record(7, NOW - 300).reference.intentId, NOW - 180); // 120s
    journal.markSettled(record(8, NOW - 200).reference.intentId, NOW - 20); // 180s

    const health = deriveSettlementHealth(journal, 'HEALTHY', NOW);
    expect(health.averageSettlementLatencySeconds).toBe(150);
    expect(health.latencySampleSize).toBe(2);
  });

  /// A transport that was slow an hour ago and is fast now should read as fast
  /// now, so the average is taken over a rolling window.
  it('averages over a rolling window rather than all history', () => {
    const journal = new InMemorySettlementJournal();
    for (let i = 0; i < 10; i++) {
      const r = record(100 + i, NOW - 1_000);
      journal.add(r);
      // The first five took 900s; the last five took 60s.
      journal.markSettled(r.reference.intentId, NOW - 1_000 + (i < 5 ? 900 : 60));
    }

    const all = deriveSettlementHealth(journal, 'HEALTHY', NOW, { latencyWindow: 10 });
    const recent = deriveSettlementHealth(journal, 'HEALTHY', NOW, { latencyWindow: 5 });

    expect(all.averageSettlementLatencySeconds).toBe(480);
    expect(recent.averageSettlementLatencySeconds).toBe(60);
  });

  /// The whole point of deriving this independently: it still answers when the
  /// transport cannot be reached, which is exactly when the risk engine needs it.
  it('reports the backlog even when the transport is unavailable', () => {
    const journal = journalWith([record(9, NOW - 900, USDC(40_000))]);

    const health = deriveSettlementHealth(journal, 'UNAVAILABLE', NOW);
    expect(health.transport).toBe('UNAVAILABLE');
    expect(health.pendingValue).toBe(USDC(40_000));
    expect(health.oldestUnsettledAgeSeconds).toBe(900);
  });
});

describe('the risk engine reacts to derived health', () => {
  const intent = {
    intentId: `0x${'a'.repeat(64)}` as `0x${string}`,
    sender: '0x1111111111111111111111111111111111111111' as const,
    recipient: RECIPIENT,
    inputToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const,
    amount: USDC(1_000),
    sourceChainId: 11155111,
    destinationChainId: 5042002,
    maxFeeBps: 100,
    deadline: NOW + 3_600,
    nonce: 1n,
    sourceTxHash: `0x${'b'.repeat(64)}` as `0x${string}`,
    sourceBlockNumber: 100n,
    createdAt: NOW - 60,
    settlementRef: `0x${'c'.repeat(64)}` as `0x${string}`,
  };

  const vault = {
    chainId: 5042002,
    vault: '0xAAaA000000000000000000000000000000000001' as const,
    asset: '0x3600000000000000000000000000000000000000' as const,
    totalBalance: USDC(100_000),
    totalShares: USDC(100_000),
    reserveFloor: USDC(10_000),
    outstandingExposure: 0n,
    accruedProtocolFees: 0n,
    paused: false,
    blockNumber: 1n,
    observedAt: NOW,
  };

  const decide = (journal: InMemorySettlementJournal, transport: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE') =>
    evaluateIntent(intent, vault, deriveSettlementHealth(journal, transport, NOW), DEFAULT_RISK_POLICY, {
      now: NOW,
      sourceConfirmations: 10,
      alreadyFilled: false,
    });

  /// This is the loop the specification asks for: what the settlement worker
  /// observes changes what the solver is willing to do.
  it('accepts normally when settlement is healthy', () => {
    expect(decide(journalWith([]), 'HEALTHY').verdict).toBe('ACCEPT');
  });

  it('rejects once the backlog grows past policy', () => {
    const journal = journalWith([record(30, NOW - 60, USDC(50_000))]);
    const decision = decide(journal, 'HEALTHY');

    expect(decision.verdict).toBe('REJECT');
    expect(decision.reason).toBe('SETTLEMENT_BACKLOG');
  });

  it('rejects once the oldest outstanding settlement is too old', () => {
    const journal = journalWith([record(31, NOW - 1_800, USDC(1_000))]);
    const decision = decide(journal, 'HEALTHY');

    expect(decision.verdict).toBe('REJECT');
    expect(decision.reason).toBe('SETTLEMENT_BACKLOG');
  });

  it('pauses when the transport is unreachable', () => {
    const decision = decide(journalWith([]), 'UNAVAILABLE');

    expect(decision.verdict).toBe('PAUSE');
    expect(decision.reason).toBe('SETTLEMENT_TRANSPORT_UNAVAILABLE');
  });

  it('charges more when settlement is slowing', () => {
    const healthy = decide(journalWith([]), 'HEALTHY');
    const slowing = decide(journalWith([]), 'DEGRADED');

    expect(slowing.feeBps).toBeGreaterThan(healthy.feeBps);
  });
});
