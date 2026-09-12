/**
 * The generator loop. Plans one phase at a time (weights nudged by the scarcity controller),
 * submits each intent when its time comes, journals every attempt, and observes the market
 * on a cadence. Injected clock/sleep make it testable at speed; SIGINT ends it cleanly.
 */
import type { LoadgenConfig } from './config.js';
import { applyMultiplier, constrainedFraction, nextMultiplier, type ScarcitySample } from './controller.js';
import { computeMetrics, type JournalEntry, type LoadgenMetrics } from './metrics.js';
import type { MarketObserver, MarketSnapshot } from './observe.js';
import { planPhase, samplePhaseIndex, type PlannedIntent } from './phases.js';
import { mulberry32, type Rng } from './rng.js';
import type { IntentSubmitter } from './submit.js';

export interface RunDependencies {
  readonly config: LoadgenConfig;
  readonly submitter: IntentSubmitter;
  readonly observer: MarketObserver | null;
  readonly clock: () => number;
  readonly sleep: (seconds: number) => Promise<void>;
  readonly onJournal: (entry: JournalEntry) => void;
  readonly onMetrics: (metrics: LoadgenMetrics) => void;
  readonly log: (line: string) => void;
  /** Stop after this many seconds of operation (tests / bounded demos); undefined = until stopped. */
  readonly totalSeconds?: number | undefined;
  readonly shouldStop?: (() => boolean) | undefined;
  readonly observeEverySeconds?: number | undefined;
  readonly rng?: Rng | undefined;
}

export interface RunSummary {
  readonly phasesRun: number;
  readonly intentsPlanned: number;
  readonly intentsSubmitted: number;
  readonly finalMultiplier: number;
}

/** Wallets on the source chain, round-robin by intent count. */
function walletFor(config: LoadgenConfig, chainId: number, counter: number): number {
  const chain = config.chains.find((c) => c.chainId === chainId);
  if (!chain) throw new Error(`No wallets configured for chain ${chainId}.`);
  return chain.walletIndices[counter % chain.walletIndices.length]!;
}

const LOW_FEE_THRESHOLD_BPS = 25;

export async function runLoadgen(deps: RunDependencies): Promise<RunSummary> {
  const { config, submitter, observer, clock, sleep, log } = deps;
  const rng = deps.rng ?? mulberry32(config.seed);
  const startedAt = clock();
  const endAt = deps.totalSeconds === undefined ? Number.POSITIVE_INFINITY : startedAt + deps.totalSeconds;
  const observeEvery = deps.observeEverySeconds ?? 30;

  const journal: JournalEntry[] = [];
  const samples: ScarcitySample[] = [];
  let latest: MarketSnapshot | null = null;
  let multiplier = 1;
  let phasesRun = 0;
  let counter = 0;
  let lastObservedAt = -Infinity;

  const observe = async () => {
    if (!observer) return;
    try {
      latest = await observer.snapshot();
      const medianIntent = medianAmount(journal);
      if (latest.aggregateAvailableLiquidity !== null && medianIntent > 0n) {
        const threshold = (medianIntent * BigInt(Math.round(config.scarcity.constrainedIfLiquidityBelowMedianIntentFraction * 10_000))) / 10_000n;
        samples.push({ at: latest.at, constrained: latest.aggregateAvailableLiquidity < threshold });
      }
      lastObservedAt = clock();
    } catch (error) {
      log(`observe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const stopped = () => deps.shouldStop?.() === true || clock() >= endAt;

  while (!stopped()) {
    const fraction = constrainedFraction(samples, clock(), config.scarcity.windowSeconds);
    multiplier = nextMultiplier(multiplier, fraction, config.scarcity);
    const weights = applyMultiplier(config.phaseWeights, config.phases.map((p) => p.kind), multiplier);
    const phase = config.phases[samplePhaseIndex(config, weights, rng)]!;
    const planned = planPhase(config, phase, clock(), rng);
    phasesRun++;
    log(
      `phase ${planned.kind} ${planned.startsAt}→${planned.endsAt} (${planned.intents.length} intents) ` +
        `constrained=${fraction === null ? 'n/a' : (fraction * 100).toFixed(0) + '%'} multiplier=${multiplier.toFixed(2)}`,
    );

    for (const intent of planned.intents) {
      if (stopped()) break;
      const wait = intent.at - clock();
      if (wait > 0) await sleep(wait);
      if (clock() - lastObservedAt >= observeEvery) await observe();
      await submitOne(intent);
    }
    // Idle to the phase end so a quiet phase is genuinely quiet.
    const idle = planned.endsAt - clock();
    if (idle > 0 && !stopped()) await sleep(Math.min(idle, Math.max(1, endAt - clock())));
    if (clock() - lastObservedAt >= observeEvery) await observe();
    deps.onMetrics(computeMetrics(journal, latest, constrainedFraction(samples, clock(), config.scarcity.windowSeconds), LOW_FEE_THRESHOLD_BPS, clock()));
  }

  async function submitOne(intent: PlannedIntent): Promise<void> {
    const walletIndex = walletFor(config, intent.sourceChainId, counter++);
    try {
      const submitted = await submitter.submit(intent, walletIndex);
      const entry: JournalEntry = { planned: intent, submitted, error: null, walletIndex };
      journal.push(entry);
      deps.onJournal(entry);
      log(`sent ${intent.tag} ${(Number(intent.amount) / 1e6).toFixed(2)} USDC ${intent.sourceChainId}→${intent.destinationChainId} maxFee ${intent.maxFeeBps} bps → ${submitted.intentId.slice(0, 10)}…`);
    } catch (error) {
      const entry: JournalEntry = { planned: intent, submitted: null, error: error instanceof Error ? error.message : String(error), walletIndex };
      journal.push(entry);
      deps.onJournal(entry);
      log(`FAILED ${intent.tag}: ${entry.error}`);
    }
  }

  return {
    phasesRun,
    intentsPlanned: journal.length,
    intentsSubmitted: journal.filter((e) => e.submitted).length,
    finalMultiplier: multiplier,
  };
}

function medianAmount(journal: readonly JournalEntry[]): bigint {
  if (journal.length === 0) return 0n;
  const sorted = journal.map((e) => e.planned.amount).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)]!;
}
