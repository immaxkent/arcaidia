import { CircleCCTPAdapter } from '../src/index.js';
import {
  runSettlementAdapterConformance,
  type ConformanceHarness,
} from './conformance/settlement-adapter-conformance.js';
import { NOW, TestClock, USDC, reference } from './fixtures.js';
import { FakeIris, FakeMessageTransmitter, MESSAGE_TRANSMITTER } from './cctp-fakes.js';

/**
 * The real transport, held to the identical suite `MockSettlementAdapter`
 * passes. See `mock-adapter.conformance.test.ts` for why this suite exists at
 * all: the mock's behaviour is a specification, and this is where the real
 * adapter is checked against it rather than assumed to match.
 */

const AMOUNT = USDC(1_000);
const DESTINATION_CHAIN_ID = 5_042_002; // Arc testnet, per fixtures.ts's default direction.
const NONCE_SEQUENCE = { next: 1n };

runSettlementAdapterConformance('CircleCCTPAdapter', {
  amount: AMOUNT,
  makeReference: (seed) => reference(seed + 2_000),

  makeHarness: (): ConformanceHarness => {
    const clock = new TestClock(NOW);
    const iris = new FakeIris();
    const transmitter = new FakeMessageTransmitter();
    transmitter.setDeliveryAmount(AMOUNT);

    const nonce = NONCE_SEQUENCE.next++;

    const adapter = new CircleCCTPAdapter({
      irisBaseUrl: 'https://iris-fake.local',
      messageTransmitter: new Map([[DESTINATION_CHAIN_ID, MESSAGE_TRANSMITTER]]),
      readers: new Map([[DESTINATION_CHAIN_ID, transmitter]]),
      writers: new Map([[DESTINATION_CHAIN_ID, transmitter]]),
      fetchFn: iris.fetchFn,
      clock: clock.now,
    });

    return {
      adapter,
      register: (ref, amount) => adapter.register(ref, amount),
      reachAttestation: async (ref) => {
        iris.setAttested(ref.sourceDomain, ref.sourceTxHash, nonce);
      },
      setReachable: (reachable) => {
        iris.reachable = reachable;
      },
      failNextCompletions: (n) => {
        transmitter.failNextWrite = n;
      },
      failNextDelivery: () => {
        transmitter.failNextReceipt = 1;
      },
      deliverExternally: async () => {
        transmitter.markUsedExternally(nonce, AMOUNT);
      },
      receiverBalance: async () => transmitter.receiverHoldings,
    };
  },
});
