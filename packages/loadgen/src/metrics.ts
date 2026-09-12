/**
 * The brief's metric list, computed from what the generator itself sent plus the market
 * snapshots it observed. Written as a rolling JSON file so WP-33 can serve the same numbers.
 */
import type { MarketSnapshot } from './observe.js';
import type { PlannedIntent } from './phases.js';
import type { SubmittedIntent } from './submit.js';

export interface JournalEntry {
  readonly planned: PlannedIntent;
  readonly submitted: SubmittedIntent | null;
  readonly error: string | null;
  readonly walletIndex: number;
}

export interface LoadgenMetrics {
  readonly computedAt: number;
  readonly intentsPlanned: number;
  readonly intentsSubmitted: number;
  readonly submissionFailures: number;
  readonly intentVolumeUsdc: string;
  readonly intentSizeUsdc: { min: string; median: string; max: string };
  readonly byPhase: Record<string, number>;
  readonly lowFeeShare: number;
  readonly constrainedFraction: number | null;
  readonly market: {
    readonly aggregateAvailableLiquidity: string | null;
    readonly aggregateOutstandingExposure: string | null;
    readonly intentsCreated: number | null;
    readonly intentsFilled: number | null;
    readonly intentsFallenBack: number | null;
    readonly fastFillRate: number | null;
    readonly canonicalOnlyRate: number | null;
    readonly perVault: ReadonlyArray<{ chainId: number; vault: string; utilisationBps: number | null; currentFeeBps: number | null; availableApprox: string }>;
  };
}

function median(values: bigint[]): bigint {
  if (values.length === 0) return 0n;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)]!;
}

const fmt = (v: bigint) => (Number(v) / 1_000_000).toFixed(2);

export function computeMetrics(
  journal: readonly JournalEntry[],
  latest: MarketSnapshot | null,
  constrainedFraction: number | null,
  lowFeeThresholdBps: number,
  now: number,
): LoadgenMetrics {
  const amounts = journal.map((e) => e.planned.amount);
  const byPhase: Record<string, number> = {};
  for (const e of journal) byPhase[e.planned.phase] = (byPhase[e.planned.phase] ?? 0) + 1;
  const created = latest?.intentsCreated ?? null;
  const filled = latest?.intentsFilled ?? null;
  const fallen = latest?.intentsFallenBack ?? null;
  return {
    computedAt: now,
    intentsPlanned: journal.length,
    intentsSubmitted: journal.filter((e) => e.submitted).length,
    submissionFailures: journal.filter((e) => e.error).length,
    intentVolumeUsdc: fmt(amounts.reduce((s, a) => s + a, 0n)),
    intentSizeUsdc: {
      min: fmt(amounts.length ? amounts.reduce((m, a) => (a < m ? a : m)) : 0n),
      median: fmt(median(amounts)),
      max: fmt(amounts.length ? amounts.reduce((m, a) => (a > m ? a : m)) : 0n),
    },
    byPhase,
    lowFeeShare: journal.length === 0 ? 0 : journal.filter((e) => e.planned.maxFeeBps < lowFeeThresholdBps).length / journal.length,
    constrainedFraction,
    market: {
      aggregateAvailableLiquidity: latest?.aggregateAvailableLiquidity === null || latest === null ? null : fmt(latest.aggregateAvailableLiquidity!),
      aggregateOutstandingExposure: latest?.aggregateOutstandingExposure === null || latest === null ? null : fmt(latest.aggregateOutstandingExposure!),
      intentsCreated: created,
      intentsFilled: filled,
      intentsFallenBack: fallen,
      fastFillRate: created && filled !== null ? filled / created : null,
      canonicalOnlyRate: created && fallen !== null ? fallen / created : null,
      perVault: (latest?.vaults ?? []).map((v) => ({
        chainId: v.chainId,
        vault: v.vault,
        utilisationBps: v.utilisationBps,
        currentFeeBps: v.currentFeeBps,
        availableApprox: fmt(v.liquidBalance - v.accruedProtocolFees),
      })),
    },
  };
}
