import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Verdict } from '@arcaidia/domain';
import { processIntent } from '@arcaidia/agent';
import { processSettlement } from '@arcaidia/settlement';
import { HttpTelemetryClient } from '@arcaidia/telemetry';
import {
  ARC,
  KEYS,
  POLICY,
  SEPOLIA,
  USDC,
  createIntent,
  settlementRecordFor,
  startWorld,
  type World,
} from '../src/index.js';

/**
 * WP-17.4 — kill the Relay.
 *
 * The unit-level version of this claim already lives in
 * `packages/agent/test/process-intent.test.ts`: a telemetry client that
 * throws synchronously on every call still lets a fill complete. This is the
 * full e2e-harness version of the same claim, one level more real — a genuine
 * `HttpTelemetryClient` (not a mock) pointed at a Relay URL nothing is
 * listening on, wired through the actual harness `solverDeps()` wiring
 * (WP-17.4's own prerequisite: "once the harness itself is wired to pass a
 * telemetry client through").
 *
 * This is the load-bearing proof for WP-17's acceptance gate: telemetry is
 * observation, never authorisation — the same rule WP-08 already holds for
 * The Graph. If this test ever needs the Relay to be reachable to pass, that
 * rule has been broken.
 */

const DOMAINS: Record<number, number> = { [SEPOLIA]: 0, [ARC]: 26 };
const RECIPIENT = '0x00000000000000000000000000000000000000A1' as const;

// Nothing binds this port. Connection refused arrives fast and deterministically
// — unlike a routable-but-blackholed address, this never has to wait out a TCP
// timeout, so the test stays fast without relying on a mocked failure.
const DEAD_RELAY_URL = 'http://127.0.0.1:1';

let world: World;
let nonce = 0n;
let telemetryFailures: Array<{ context: 'reportStage' | 'heartbeat' }> = [];

beforeAll(async () => {
  telemetryFailures = [];
  world = await startWorld({
    ports: [8547, 8548],
    telemetry: new HttpTelemetryClient({
      relayUrl: DEAD_RELAY_URL,
      onError: (_error, context) => telemetryFailures.push({ context }),
    }),
  });
}, 180_000);

afterAll(() => world?.stop());

describe('the golden run survives a dead Relay', () => {
  it.each([
    ['ethereum to arc', SEPOLIA],
    ['arc to ethereum', ARC],
  ])('settles %s end to end with TELEMETRY reporting into nothing', async (_label, sourceChainId) => {
    const destinationChainId = sourceChainId === SEPOLIA ? ARC : SEPOLIA;
    const amount = USDC(1_000);

    const recipientBefore = await world.balanceOf(destinationChainId, RECIPIENT);
    const vaultBefore = await world.vaultState(destinationChainId);

    const intent = await createIntent(world.chains[sourceChainId]!, world.deployments[sourceChainId]!, {
      userKey: KEYS.user,
      recipient: RECIPIENT,
      amount,
      destinationChainId,
      maxFeeBps: 100,
      deadline: world.now() + 3_600,
      nonce: nonce++,
    });

    const record = settlementRecordFor(intent, DOMAINS[sourceChainId]!, DOMAINS[destinationChainId]!);
    world.settlementAdapter.register(record.reference, record.amount);
    world.settlementJournal.add(record);

    await world.refreshObservation(intent);

    // --- the fast path, exactly as the golden run asserts it -------------

    const fill = await processIntent(intent, world.solverDeps());

    expect(fill.kind).toBe('FILLED');
    if (fill.kind !== 'FILLED') throw new Error('expected a fill');
    expect(fill.decision.verdict).toBe(Verdict.ACCEPT);

    const fee = fill.decision.feeAmount;
    const output = fill.decision.outputAmount;
    expect(output + fee).toBe(amount);
    expect(await world.balanceOf(destinationChainId, RECIPIENT)).toBe(recipientBefore + output);

    world.observation.markFilled(intent.intentId);

    // --- the canonical path, exactly as the golden run asserts it --------

    expect((await processSettlement(record, world.settlementDeps())).kind).toBe('WAITING');

    await world.advance(POLICY.attestationDelaySeconds);

    const settled = await processSettlement(record, world.settlementDeps());
    expect(settled).toMatchObject({ kind: 'SETTLED', outcome: 'LP_REIMBURSED' });

    // --- the books, exactly as the golden run asserts them ---------------

    const after = await world.vaultState(destinationChainId);
    expect(after.outstandingExposure).toBe(vaultBefore.outstandingExposure);
    expect(after.totalBalance).toBe(vaultBefore.totalBalance + fee);
  }, 120_000);

  it('actually tried to reach the Relay, and failed, at every stage — this is not a no-op client', () => {
    // The load-bearing check. A passing run above proves nothing about
    // telemetry surviving failure if telemetry was never really exercised —
    // this asserts the HttpTelemetryClient really posted against the dead
    // port and really observed every one of those posts fail, for every
    // pre-chain stage `processIntent` reports.
    expect(telemetryFailures.length).toBeGreaterThanOrEqual(4);
    expect(telemetryFailures.every((f) => f.context === 'reportStage')).toBe(true);
  });
});
