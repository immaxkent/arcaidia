import { expect, describe, it, beforeEach } from 'vitest';
import { SettlementStatus, type SettlementAdapter, type SettlementReference } from '@arcaidia/domain';

/**
 * The contract every settlement transport must satisfy.
 *
 * `MockSettlementAdapter` passes this today; `CircleCCTPAdapter` must pass the
 * same suite in WP-10, against a real network. That is the point of writing it
 * as a shared suite rather than as tests for one implementation: the mock's
 * behaviour becomes a *specification* rather than an accident, and the real
 * adapter cannot quietly diverge from what the worker has been built to expect.
 *
 * Both paths are required. A transport that only proves its happy path leaves
 * every failure mode to be discovered on a live network with real money — which
 * is precisely the position this whole local harness exists to avoid.
 */

export interface ConformanceHarness {
  readonly adapter: SettlementAdapter;

  /** Register a committed transfer the adapter should track. */
  register(reference: SettlementReference, amount: bigint): Promise<void> | void;

  /** Move the world forward until the attestation is available. */
  reachAttestation(reference: SettlementReference): Promise<void>;

  /** Make the transport unreachable, or reachable again. */
  setReachable(reachable: boolean): void;

  /** Make the next `n` completion attempts fail transiently. */
  failNextCompletions(n: number): void;

  /**
   * Make delivery of funds fail on the next attempt.
   *
   * For CCTP this is `receiveMessage` reverting or the mint not landing.
   * Optional only because a transport with no separable delivery step cannot
   * express it; every real one can.
   */
  failNextDelivery?(): void;

  /**
   * Have somebody else deliver the message first.
   *
   * On a real network anyone may submit `receiveMessage`. An adapter that
   * treats an already-consumed nonce as a failure will strand settlements that
   * have, in fact, completed.
   */
  deliverExternally?(reference: SettlementReference): Promise<void>;

  /** How much of the settlement asset the destination receiver holds. */
  receiverBalance?(reference: SettlementReference): Promise<bigint>;
}

export interface ConformanceOptions {
  /** A fresh harness and a fresh reference per test. */
  makeHarness(): Promise<ConformanceHarness> | ConformanceHarness;
  makeReference(seed: number): SettlementReference;
  readonly amount: bigint;
}

export function runSettlementAdapterConformance(name: string, options: ConformanceOptions): void {
  describe(`${name} — settlement adapter conformance`, () => {
    let harness: ConformanceHarness;
    let seed = 0;
    let reference: SettlementReference;

    beforeEach(async () => {
      harness = await options.makeHarness();
      reference = options.makeReference(seed++);
      await harness.register(reference, options.amount);
    });

    // ---------------------------------------------------------------------
    // The happy path
    // ---------------------------------------------------------------------

    describe('happy path', () => {
      it('reports the message pending before attestation', async () => {
        const state = await harness.adapter.status(reference);
        expect([SettlementStatus.INITIATED, SettlementStatus.PENDING_ATTESTATION]).toContain(
          state.status,
        );
      });

      it('reports the committed amount', async () => {
        expect((await harness.adapter.status(reference)).amount).toBe(options.amount);
      });

      it('reaches ATTESTED and no further on its own', async () => {
        await harness.reachAttestation(reference);
        expect((await harness.adapter.status(reference)).status).toBe(SettlementStatus.ATTESTED);
      });

      it('completes once attested', async () => {
        await harness.reachAttestation(reference);
        const state = await harness.adapter.complete(reference);
        expect(state.status).toBe(SettlementStatus.RECEIVED);
      });

      it('records a destination transaction on completion', async () => {
        await harness.reachAttestation(reference);
        const state = await harness.adapter.complete(reference);
        expect(state.destinationTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
      });

      /// Status is a claim about the world, so it must not be reported until
      /// the world actually reflects it.
      it('delivers the funds it claims to have delivered', async () => {
        if (!harness.receiverBalance) return;

        const before = await harness.receiverBalance(reference);
        await harness.reachAttestation(reference);
        await harness.adapter.complete(reference);

        expect(await harness.receiverBalance(reference)).toBe(before + options.amount);
      });

      it('answers health', async () => {
        const health = await harness.adapter.health();
        expect(['HEALTHY', 'DEGRADED', 'UNAVAILABLE']).toContain(health.transport);
      });
    });

    // ---------------------------------------------------------------------
    // The sad paths
    // ---------------------------------------------------------------------

    describe('sad paths', () => {
      /// The worker polls constantly. Completing early must be impossible, not
      /// merely discouraged.
      it('refuses to complete before attestation', async () => {
        await expect(harness.adapter.complete(reference)).rejects.toThrow();
      });

      it('leaves the message untouched after a premature completion attempt', async () => {
        await harness.adapter.complete(reference).catch(() => {});
        const state = await harness.adapter.status(reference);
        expect(state.status).not.toBe(SettlementStatus.RECEIVED);
      });

      it('throws rather than reporting stale state when unreachable', async () => {
        harness.setReachable(false);
        await expect(harness.adapter.status(reference)).rejects.toThrow();
        harness.setReachable(true);
      });

      /// Rate limits and timeouts are ordinary weather for an attestation
      /// service. Retrying must work, and must not double-deliver.
      it('recovers from a transient completion failure', async () => {
        await harness.reachAttestation(reference);
        harness.failNextCompletions(1);

        await expect(harness.adapter.complete(reference)).rejects.toThrow();
        expect((await harness.adapter.complete(reference)).status).toBe(SettlementStatus.RECEIVED);
      });

      it('does not deliver funds on a failed completion', async () => {
        if (!harness.receiverBalance) return;

        await harness.reachAttestation(reference);
        const before = await harness.receiverBalance(reference);

        harness.failNextCompletions(1);
        await harness.adapter.complete(reference).catch(() => {});

        expect(await harness.receiverBalance(reference)).toBe(before);
      });

      /// The ordering that matters: if delivery fails, the message must remain
      /// attested and retryable rather than being recorded as received. An
      /// adapter that marks receipt first strands funds that never arrived.
      it('stays retryable when delivery itself fails', async () => {
        if (!harness.failNextDelivery) return;

        await harness.reachAttestation(reference);
        harness.failNextDelivery();

        await expect(harness.adapter.complete(reference)).rejects.toThrow();
        expect((await harness.adapter.status(reference)).status).toBe(SettlementStatus.ATTESTED);

        expect((await harness.adapter.complete(reference)).status).toBe(SettlementStatus.RECEIVED);
      });

      it('refuses to report on a message it never saw', async () => {
        await expect(harness.adapter.status(options.makeReference(9_999))).rejects.toThrow();
      });
    });

    // ---------------------------------------------------------------------
    // Idempotency
    // ---------------------------------------------------------------------

    describe('idempotency', () => {
      it('returns the same state when completed twice', async () => {
        await harness.reachAttestation(reference);
        const first = await harness.adapter.complete(reference);
        const second = await harness.adapter.complete(reference);

        expect(second.status).toBe(first.status);
        expect(second.destinationTxHash).toBe(first.destinationTxHash);
      });

      it('delivers exactly once across repeated completions', async () => {
        if (!harness.receiverBalance) return;

        const before = await harness.receiverBalance(reference);
        await harness.reachAttestation(reference);
        await harness.adapter.complete(reference);
        await harness.adapter.complete(reference);

        expect(await harness.receiverBalance(reference)).toBe(before + options.amount);
      });

      /// Anyone may submit the destination transaction on a real network. An
      /// adapter that reads an already-consumed message as a failure would
      /// strand settlements that have in fact completed.
      it('treats an externally delivered message as complete', async () => {
        if (!harness.deliverExternally) return;

        await harness.reachAttestation(reference);
        await harness.deliverExternally(reference);

        const state = await harness.adapter.complete(reference);
        expect([SettlementStatus.RECEIVED, SettlementStatus.RECONCILED]).toContain(state.status);
      });

      it('does not double-deliver after an external delivery', async () => {
        if (!harness.deliverExternally || !harness.receiverBalance) return;

        await harness.reachAttestation(reference);
        await harness.deliverExternally(reference);
        const afterExternal = await harness.receiverBalance(reference);

        await harness.adapter.complete(reference);
        expect(await harness.receiverBalance(reference)).toBe(afterExternal);
      });
    });
  });
}
