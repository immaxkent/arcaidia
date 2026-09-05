/**
 * Settlement health, derived from the worker's own records.
 *
 * The transport reports its own health, but the worker can compute the same
 * figures independently from what it has seen. Two sources that must agree is
 * a stronger position than one source that cannot be checked — and if the
 * transport is unreachable, this still answers.
 *
 * Pure. The risk engine consumes the result (WP-04.6) to decide whether to
 * reprice, reject or pause.
 */

import type { SettlementHealth, UnixSeconds } from '@arcaidia/domain';
import type { SettlementJournal } from './worker/ports.js';

export interface HealthOptions {
  /** How many recent settlements the latency average is taken over. */
  readonly latencyWindow?: number;
}

export function deriveSettlementHealth(
  journal: SettlementJournal,
  transport: SettlementHealth['transport'],
  now: UnixSeconds,
  options: HealthOptions = {},
): SettlementHealth {
  const window = options.latencyWindow ?? 20;

  const pending = journal.pending();
  const pendingValue = pending.reduce((sum, record) => sum + record.amount, 0n);

  const ages = pending.map((record) => now - record.reference.initiatedAt);
  const oldestUnsettledAgeSeconds = ages.length === 0 ? null : Math.max(...ages);

  // Latency over a rolling window rather than all history: a transport that was
  // slow an hour ago and is fast now should read as fast now.
  const latencies: number[] = [];
  for (const record of journal.all()) {
    const settledAt = journal.settledAt(record.reference.intentId);
    if (settledAt !== undefined) {
      latencies.push(settledAt - record.reference.initiatedAt);
    }
  }

  const recent = latencies.slice(-window);
  const averageSettlementLatencySeconds =
    recent.length === 0
      ? null
      : Math.round(recent.reduce((sum, value) => sum + value, 0) / recent.length);

  return {
    transport,
    oldestUnsettledAgeSeconds,
    pendingValue,
    averageSettlementLatencySeconds,
    latencySampleSize: recent.length,
    observedAt: now,
  };
}
