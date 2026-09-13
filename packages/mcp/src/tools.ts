/**
 * What an agent may ask Arcaidia.
 *
 * These are the tool implementations, kept separate from the MCP transport so
 * they can be tested as ordinary functions. They read through the same
 * `ObservationProvider` the solver itself uses, so an answer given here is the
 * state the agent would actually have decided against — not a parallel view
 * that can drift.
 *
 * ## Everything here is read-only, deliberately
 *
 * There is no tool to fill an intent, move liquidity, change a policy or pause
 * a vault. A language model with a natural-language interface to capital is a
 * category of risk this protocol has spent its entire design avoiding: the
 * decision path is a pure function precisely so that no model sits in it. This
 * server is a window, not a lever.
 */

import {
  availableLiquidity,
  totalAssets,
  utilisationBps,
  type Bytes32,
  type IntelligenceProvider,
  type ObservationProvider,
  type UnixSeconds,
} from '@arcaidia/domain';
import { formatBps, formatDuration, shortAddress, usdc } from './format.js';

export interface VaultReport {
  readonly chain: string;
  readonly chainId: number;
  readonly vault: string;
  readonly totalAssets: string;
  readonly availableToLend: string;
  readonly advancedAndAwaitingSettlement: string;
  readonly utilisation: string;
  readonly protocolFeesOwed: string;
  readonly paused: boolean;
  readonly observationAge: string;
  readonly summary: string;
}

export interface SettlementReport {
  readonly transport: string;
  readonly pendingValue: string;
  readonly oldestUnsettledAge: string | null;
  readonly averageSettlementLatency: string | null;
  readonly summary: string;
}

export interface PendingIntentReport {
  readonly intentId: string;
  readonly route: string;
  readonly amount: string;
  readonly recipient: string;
  readonly maxFee: string;
  readonly ageSeconds: number;
}

/** The market as a whole, from the relay's ecosystem intelligence (WP-33). */
export interface EcosystemReport {
  readonly availableLiquidity: string;
  readonly utilisation: string;
  readonly vaults: number;
  readonly feeRange: string;
  readonly outstandingIntents: string;
  readonly awaitingSettlement: string;
  readonly fillsPerHour: string;
  readonly settlementLatency: string;
  readonly largestFillableNow: string;
  readonly scarcity: string;
  readonly concentration: string;
  readonly computedAgo: string;
  readonly summary: string;
}

export interface ArcaidiaToolOptions {
  readonly observation: ObservationProvider;
  /** WP-33: optional. Without it `ecosystemIntelligence` says so rather than guessing. */
  readonly intelligence?: IntelligenceProvider;
  /** Human names for chain ids, so answers read as prose rather than numbers. */
  readonly chainNames: ReadonlyMap<number, string>;
  readonly clock?: () => UnixSeconds;
}

export class ArcaidiaTools {
  private readonly observation: ObservationProvider;
  private readonly intelligence: IntelligenceProvider | undefined;
  private readonly chainNames: ReadonlyMap<number, string>;
  private readonly clock: () => UnixSeconds;

  constructor(options: ArcaidiaToolOptions) {
    this.observation = options.observation;
    this.intelligence = options.intelligence;
    this.chainNames = options.chainNames;
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * The whole market at a glance — liquidity, price, scarcity, throughput — read from the
   * relay's ecosystem intelligence. Read-only like everything else here; a missing provider is
   * reported, never papered over with numbers of our own.
   */
  async ecosystemIntelligence(): Promise<EcosystemReport> {
    if (!this.intelligence) {
      throw new Error('Ecosystem intelligence is not configured for this server (set INTELLIGENCE_URL to the relay).');
    }
    const now = this.clock();
    const view = await this.intelligence.ecosystem(now);
    const fees = view.feeDistribution;
    const duration = (seconds: number): string => formatDuration(seconds) ?? `${seconds}s`;
    const feeRange =
      fees.minBps === null || fees.maxBps === null
        ? 'no active vault'
        : fees.minBps === fees.maxBps
          ? formatBps(fees.minBps)
          : `${formatBps(fees.minBps)} – ${formatBps(fees.maxBps)} (median ${formatBps(fees.medianBps ?? fees.minBps)})`;
    const latency =
      view.recentSettlementLatency.p50Seconds === null
        ? 'no settlements in the window'
        : `p50 ${duration(view.recentSettlementLatency.p50Seconds)}, p95 ${duration(view.recentSettlementLatency.p95Seconds ?? view.recentSettlementLatency.p50Seconds)} over ${view.recentSettlementLatency.sampleSize}`;
    const report: EcosystemReport = {
      availableLiquidity: usdc(view.aggregateAvailableLiquidity),
      utilisation: formatBps(view.aggregateUtilisationBps),
      vaults: fees.perVault.length,
      feeRange,
      outstandingIntents: usdc(view.outstandingIntentVolume),
      awaitingSettlement: usdc(view.pendingCctpExposure),
      fillsPerHour: view.recentFillVelocityPerHour === null ? 'unknown' : view.recentFillVelocityPerHour.toFixed(1),
      settlementLatency: latency,
      largestFillableNow: usdc(view.estimatedOpportunitySize),
      scarcity: formatBps(view.scarcityScoreBps),
      concentration: view.liquidityConcentrationBps === null ? 'no liquidity' : formatBps(view.liquidityConcentrationBps),
      computedAgo: duration(Math.max(0, now - view.computedAt)),
      summary: '',
    };
    return {
      ...report,
      summary:
        `${report.vaults} vault(s) with ${report.availableLiquidity} available, ${report.utilisation} utilised; ` +
        `fees ${report.feeRange}; ${report.outstandingIntents} of intents outstanding, scarcity ${report.scarcity}; ` +
        `largest fillable now ${report.largestFillableNow}; ${report.fillsPerHour} fills/hour; settlement ${report.settlementLatency}.`,
    };
  }

  private chainName(chainId: number): string {
    return this.chainNames.get(chainId) ?? `chain ${chainId}`;
  }

  /** How much a vault holds, how much is lent out, and how busy it is. */
  async vaultState(chainId: number): Promise<VaultReport> {
    const vault = await this.observation.vaultState(chainId);

    const assets = totalAssets(vault);
    const available = availableLiquidity(vault);
    const utilisation = utilisationBps(vault);
    const age = Math.max(0, this.clock() - vault.observedAt);

    const name = this.chainName(chainId);
    const summary = vault.paused
      ? `The ${name} vault is paused and is not advancing liquidity. It holds ${usdc(assets)}.`
      : `The ${name} vault holds ${usdc(assets)}, of which ${usdc(available)} can be advanced ` +
        `right now. ${usdc(vault.outstandingExposure)} is already advanced and awaiting canonical ` +
        `settlement, putting utilisation at ${formatBps(utilisation)}.`;

    return {
      chain: name,
      chainId,
      vault: shortAddress(vault.vault),
      totalAssets: usdc(assets),
      availableToLend: usdc(available),
      advancedAndAwaitingSettlement: usdc(vault.outstandingExposure),
      utilisation: formatBps(utilisation),
      protocolFeesOwed: usdc(vault.accruedProtocolFees),
      paused: vault.paused,
      // Surfaced rather than hidden: an answer from a stale indexer is still an
      // answer, but the reader deserves to know how old it is.
      observationAge: formatDuration(age) ?? '0s',
      summary,
    };
  }

  /** Whether canonical settlement is keeping up. */
  async settlementHealth(): Promise<SettlementReport> {
    const health = await this.observation.settlementHealth();

    const oldest = formatDuration(health.oldestUnsettledAgeSeconds);
    const latency = formatDuration(health.averageSettlementLatencySeconds);

    const summary =
      health.pendingValue === 0n
        ? `Nothing is awaiting canonical settlement. The transport reports ${health.transport.toLowerCase()}.`
        : `${usdc(health.pendingValue)} is advanced and awaiting canonical settlement` +
          (oldest ? `, the oldest for ${oldest}` : '') +
          `. The transport reports ${health.transport.toLowerCase()}` +
          (latency ? ` with recent settlements averaging ${latency}` : '') +
          '.';

    return {
      transport: health.transport,
      pendingValue: usdc(health.pendingValue),
      oldestUnsettledAge: oldest,
      averageSettlementLatency: latency,
      summary,
    };
  }

  /** Transfers waiting for a solver to act. */
  async pendingIntents(): Promise<readonly PendingIntentReport[]> {
    const intents = await this.observation.pendingIntents();
    const now = this.clock();

    return intents.map((intent) => ({
      intentId: shortAddress(intent.intentId),
      route: `${this.chainName(intent.sourceChainId)} → ${this.chainName(intent.destinationChainId)}`,
      amount: usdc(intent.amount),
      recipient: shortAddress(intent.recipient),
      maxFee: formatBps(intent.maxFeeBps),
      ageSeconds: Math.max(0, now - intent.createdAt),
    }));
  }

  /** Whether a particular transfer has been advanced yet. */
  async intentStatus(intentId: Bytes32): Promise<{ intentId: string; filled: boolean; summary: string }> {
    const filled = await this.observation.isFilled(intentId);

    return {
      intentId: shortAddress(intentId),
      filled,
      summary: filled
        ? `Intent ${shortAddress(intentId)} has been fast-filled: the recipient has been paid from ` +
          'liquidity provider capital, and canonical settlement will reimburse the vault.'
        : `Intent ${shortAddress(intentId)} has not been fast-filled. Either no solver has acted ` +
          'yet, or it will settle at canonical speed through CCTP.',
    };
  }
}
