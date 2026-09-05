import { MockSettlementAdapter } from '../src/index.js';
import {
  runSettlementAdapterConformance,
  type ConformanceHarness,
} from './conformance/settlement-adapter-conformance.js';
import { NOW, TestClock, USDC, reference } from './fixtures.js';

/**
 * The mock, held to the same contract the real transport will be.
 *
 * Running the shared suite here is what turns the mock's behaviour into a
 * specification. WP-10 points the identical suite at `CircleCCTPAdapter`, so
 * the real transport cannot quietly behave differently from what the settlement
 * worker was built against.
 */

const DELAY = 120;

runSettlementAdapterConformance('MockSettlementAdapter', {
  amount: USDC(1_000),
  makeReference: (seed) => reference(seed + 500),

  makeHarness: (): ConformanceHarness => {
    const clock = new TestClock(NOW);

    // A stand-in for the destination receiver's balance, so the suite can
    // assert that funds actually moved rather than that a status changed.
    let receiverHoldings = 0n;
    let failDeliveryOnce = false;

    const adapter = new MockSettlementAdapter({
      attestationDelaySeconds: DELAY,
      clock: clock.now,
      onComplete: async (_ref, amount) => {
        if (failDeliveryOnce) {
          failDeliveryOnce = false;
          throw new Error('destination delivery reverted');
        }
        receiverHoldings += amount;
      },
    });

    return {
      adapter,
      register: (ref, amount) => adapter.register(ref, amount),
      reachAttestation: async () => clock.advance(DELAY),
      setReachable: (reachable) => adapter.setReachable(reachable),
      failNextCompletions: (n) => adapter.failNextCompletions(n),
      failNextDelivery: () => {
        failDeliveryOnce = true;
      },
      deliverExternally: async (ref) => {
        receiverHoldings += USDC(1_000);
        adapter.markDelivered(ref.intentId);
      },
      receiverBalance: async () => receiverHoldings,
    };
  },
});
