/**
 * A canonical settlement transport that behaves like the real one.
 *
 * The point of a mock here is not to make tests pass; it is to make the
 * *awkward* parts of CCTP reproducible. Attestations take minutes and arrive on
 * someone else's schedule, services rate-limit and time out, and the whole
 * thing occasionally stops. A mock that only models the happy path would leave
 * WP-10 as the first time any of that is handled, against a live network, with
 * real money.
 *
 * So this one has: a configurable attestation delay, transient failures that
 * succeed on retry, and an unavailable mode that drives the risk engine's PAUSE
 * branch.
 */

import {
  ACTIVE_SETTLEMENT_STATUSES,
  SettlementStatus,
  type Bytes32,
  type SettlementAdapter,
  type SettlementHealth,
  type SettlementReference,
  type SettlementState,
  type TxHash,
  type UnixSeconds,
} from '@arcaidia/domain';

export interface MockSettlementOptions {
  /** Seconds between initiation and the attestation becoming available. */
  readonly attestationDelaySeconds?: number;
  /** Clock, injected so tests need not wait in real time. */
  readonly clock?: () => UnixSeconds;
  /**
   * Called when a message completes, before the state is returned.
   *
   * Real CCTP *mints* USDC to the destination receiver as part of completing;
   * without an equivalent here the receiver would hold nothing and settlement
   * would revert. A local harness wires this to a mint so the canonical funds
   * genuinely arrive on the destination chain.
   */
  readonly onComplete?: (reference: SettlementReference, amount: bigint) => Promise<void>;
}

interface Tracked {
  readonly reference: SettlementReference;
  readonly amount: bigint;
  status: SettlementStatus;
  destinationTxHash?: TxHash;
  failureReason?: string;
  updatedAt: UnixSeconds;
  completedAt?: UnixSeconds;
}

export class MockSettlementAdapter implements SettlementAdapter {
  private readonly tracked = new Map<string, Tracked>();
  private readonly delay: number;
  private readonly clock: () => UnixSeconds;
  private readonly onComplete?: (reference: SettlementReference, amount: bigint) => Promise<void>;

  /** Set false to simulate the transport being unreachable. */
  private reachable = true;

  /** Number of `complete` calls that should fail before one succeeds. */
  private transientFailures = 0;

  constructor(options: MockSettlementOptions = {}) {
    this.delay = options.attestationDelaySeconds ?? 120;
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
    if (options.onComplete) this.onComplete = options.onComplete;
  }

  // --- test controls ------------------------------------------------------

  setReachable(reachable: boolean): void {
    this.reachable = reachable;
  }

  /** The next `n` completions fail, then behave normally. Models a rate limit. */
  failNextCompletions(n: number): void {
    this.transientFailures = n;
  }

  /**
   * Register a message the router has committed.
   *
   * On a real chain this is discovered by watching the source; here the test or
   * the harness declares it, which keeps the worker's logic identical either way.
   */
  register(reference: SettlementReference, amount: bigint): void {
    this.tracked.set(key(reference.intentId), {
      reference,
      amount,
      status: SettlementStatus.INITIATED,
      updatedAt: this.clock(),
    });
  }

  // --- SettlementAdapter --------------------------------------------------

  async status(reference: SettlementReference): Promise<SettlementState> {
    this.assertReachable();
    const entry = this.require(reference.intentId);

    // Statuses that depend on the passage of time are derived on read, so a
    // test advancing its clock sees exactly what a worker polling a real
    // attestation service would see.
    if (
      entry.status === SettlementStatus.INITIATED ||
      entry.status === SettlementStatus.PENDING_ATTESTATION
    ) {
      const elapsed = this.clock() - entry.reference.initiatedAt;
      entry.status =
        elapsed >= this.delay ? SettlementStatus.ATTESTED : SettlementStatus.PENDING_ATTESTATION;
      entry.updatedAt = this.clock();
    }

    return this.snapshot(entry);
  }

  /**
   * Complete the destination leg.
   *
   * Idempotent by design: completing an already-completed message returns the
   * same state rather than moving funds twice. A worker that crashed after
   * submitting and retried on restart must not double-pay.
   */
  async complete(reference: SettlementReference): Promise<SettlementState> {
    this.assertReachable();
    const entry = this.require(reference.intentId);

    if (entry.status === SettlementStatus.RECEIVED || entry.status === SettlementStatus.RECONCILED) {
      return this.snapshot(entry);
    }

    const current = await this.status(reference);
    if (current.status !== SettlementStatus.ATTESTED) {
      throw new Error(
        `Cannot complete ${reference.intentId}: attestation is ${current.status}, not ATTESTED.`,
      );
    }

    if (this.transientFailures > 0) {
      this.transientFailures -= 1;
      throw new Error('Transport temporarily unavailable; retry.');
    }

    // Deliver the funds before recording receipt. If delivery fails the message
    // stays attested and the worker retries, rather than believing funds
    // arrived that never did.
    if (this.onComplete) await this.onComplete(reference, entry.amount);

    entry.status = SettlementStatus.RECEIVED;
    entry.destinationTxHash = syntheticHash(reference.intentId);
    entry.completedAt = this.clock();
    entry.updatedAt = this.clock();

    return this.snapshot(entry);
  }

  async health(): Promise<SettlementHealth> {
    const now = this.clock();

    if (!this.reachable) {
      return {
        transport: 'UNAVAILABLE',
        oldestUnsettledAgeSeconds: this.oldestUnsettledAge(now),
        pendingValue: this.pendingValue(),
        averageSettlementLatencySeconds: this.averageLatency(),
        latencySampleSize: this.completed().length,
        observedAt: now,
      };
    }

    const average = this.averageLatency();
    return {
      // Slower than twice the configured delay counts as degraded: the
      // transport is answering, but not on the schedule it promised.
      transport: average !== null && average > this.delay * 2 ? 'DEGRADED' : 'HEALTHY',
      oldestUnsettledAgeSeconds: this.oldestUnsettledAge(now),
      pendingValue: this.pendingValue(),
      averageSettlementLatencySeconds: average,
      latencySampleSize: this.completed().length,
      observedAt: now,
    };
  }

  /** Marks a message reconciled once the receiver has routed the funds. */
  markReconciled(intentId: Bytes32): void {
    const entry = this.tracked.get(key(intentId));
    if (entry) {
      entry.status = SettlementStatus.RECONCILED;
      entry.updatedAt = this.clock();
    }
  }

  /** Everything still in flight, for the worker to poll. */
  active(): readonly SettlementState[] {
    return [...this.tracked.values()]
      .filter((entry) => ACTIVE_SETTLEMENT_STATUSES.includes(entry.status))
      .map((entry) => this.snapshot(entry));
  }

  // --- internals ----------------------------------------------------------

  private assertReachable(): void {
    if (!this.reachable) throw new Error('Settlement transport is unreachable.');
  }

  private require(intentId: Bytes32): Tracked {
    const entry = this.tracked.get(key(intentId));
    if (!entry) throw new Error(`No settlement registered for ${intentId}.`);
    return entry;
  }

  private snapshot(entry: Tracked): SettlementState {
    const base = {
      reference: entry.reference,
      status: entry.status,
      amount: entry.amount,
      updatedAt: entry.updatedAt,
    };
    return entry.destinationTxHash === undefined
      ? base
      : { ...base, destinationTxHash: entry.destinationTxHash };
  }

  private completed(): Tracked[] {
    return [...this.tracked.values()].filter((entry) => entry.completedAt !== undefined);
  }

  private averageLatency(): number | null {
    const done = this.completed();
    if (done.length === 0) return null;
    const total = done.reduce(
      (sum, entry) => sum + (entry.completedAt! - entry.reference.initiatedAt),
      0,
    );
    return Math.round(total / done.length);
  }

  private unsettled(): Tracked[] {
    return [...this.tracked.values()].filter((entry) =>
      ACTIVE_SETTLEMENT_STATUSES.includes(entry.status),
    );
  }

  private oldestUnsettledAge(now: UnixSeconds): number | null {
    const ages = this.unsettled().map((entry) => now - entry.reference.initiatedAt);
    return ages.length === 0 ? null : Math.max(...ages);
  }

  private pendingValue(): bigint {
    return this.unsettled().reduce((sum, entry) => sum + entry.amount, 0n);
  }
}

const key = (intentId: Bytes32): string => intentId.toLowerCase();

const syntheticHash = (intentId: Bytes32): TxHash =>
  `0x${intentId.slice(2, 10).padEnd(64, 'f')}` as TxHash;
