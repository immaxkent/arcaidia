import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerDeployment, resetDeployments } from '@arcaidia/domain';
import {
  DEFAULT_RISK_POLICY,
  InMemorySubmissionJournal,
  SequentialNonceSource,
  runSolverPass,
  type SolverDependencies,
} from '../src/index.js';
import { InMemoryDecisionLog } from '../src/logging/decision-log.js';
import type { SourceEvidence } from '../src/verification/source-evidence.js';
import { ARC, NOW, SEPOLIA, health, intent, vault } from './fixtures.js';
import {
  FakeObservationProvider,
  FakeSourceReader,
  FakeSubmitter,
  RecordingAuthority,
} from './solver-fakes.js';

const SEPOLIA_ROUTER = '0x1111111111111111111111111111111111111111' as const;
const SEPOLIA_VAULT = '0x2222222222222222222222222222222222222222' as const;
const SEPOLIA_RECEIVER = '0x3333333333333333333333333333333333333333' as const;
const ARC_ROUTER = '0x4444444444444444444444444444444444444444' as const;
const ARC_VAULT = '0x5555555555555555555555555555555555555555' as const;
const ARC_RECEIVER = '0x6666666666666666666666666666666666666666' as const;

const baseIntent = intent();

function evidenceFor(i = baseIntent, router: `0x${string}` = SEPOLIA_ROUTER): SourceEvidence {
  return {
    txHash: i.sourceTxHash,
    status: 'success',
    to: router,
    blockNumber: 100n,
    currentBlockNumber: 110n,
    intentCreated: {
      intentId: i.intentId,
      sender: i.sender,
      recipient: i.recipient,
      inputToken: i.inputToken,
      amount: i.amount,
      sourceChainId: i.sourceChainId,
      destinationChainId: i.destinationChainId,
      maxFeeBps: i.maxFeeBps,
      deadline: i.deadline,
      nonce: i.nonce,
      settlementRef: i.settlementRef,
      emitter: router,
    },
  };
}

/**
 * `runSolverPass` sits between `processIntent` (tested exhaustively in
 * process-intent.test.ts) and the continuous worker loop (solver-worker.test.ts).
 * These tests are about the pass's own job only: discover, process each
 * discovered intent independently, and never let one intent's outcome —
 * refusal or thrown error alike — affect any other intent in the same pass.
 */
describe('runSolverPass', () => {
  let observation: FakeObservationProvider;
  let sourceReader: FakeSourceReader;
  let authority: RecordingAuthority;
  let submitter: FakeSubmitter;
  let log: InMemoryDecisionLog;
  let deps: SolverDependencies;

  beforeEach(() => {
    registerDeployment('ethereum-sepolia', {
      intentRouter: SEPOLIA_ROUTER,
      liquidityVault: SEPOLIA_VAULT,
      settlementReceiver: SEPOLIA_RECEIVER,
    });
    registerDeployment('arc-testnet', {
      intentRouter: ARC_ROUTER,
      liquidityVault: ARC_VAULT,
      settlementReceiver: ARC_RECEIVER,
    });

    observation = new FakeObservationProvider(vault(), health());
    sourceReader = new FakeSourceReader(evidenceFor());
    authority = new RecordingAuthority();
    submitter = new FakeSubmitter();
    log = new InMemoryDecisionLog();

    deps = {
      observation,
      sourceReader,
      authority,
      submitter,
      log,
      clock: () => NOW,
      nonces: new SequentialNonceSource(),
      journal: new InMemorySubmissionJournal(),
      config: { policy: DEFAULT_RISK_POLICY, authorizationTtlSeconds: 45 },
    };
  });

  afterEach(() => resetDeployments());

  it('reports RAN with an empty map when nothing is pending', async () => {
    observation.pending = [];
    const result = await runSolverPass(deps);
    expect(result).toEqual({ kind: 'RAN', outcomes: new Map() });
  });

  it('processes every pending intent and keys each outcome by its intent id', async () => {
    observation.pending = [baseIntent];
    const result = await runSolverPass(deps);

    if (result.kind !== 'RAN') throw new Error(result.kind);
    expect(result.outcomes.size).toBe(1);
    expect(result.outcomes.get(baseIntent.intentId)?.kind).toBe('FILLED');
    expect(submitter.submissions).toHaveLength(1);
  });

  it("one intent's outcome does not depend on another's in the same pass", async () => {
    // Second intent's sourceTxHash does not match the fake evidence on file
    // (the fake always answers for baseIntent's tx), so it is refused as
    // unverified — a different, independently-caused outcome from the first.
    const unverifiable = intent({
      intentId: '0x'.padEnd(66, 'd') as `0x${string}`,
      sourceTxHash: '0x'.padEnd(66, 'e') as `0x${string}`,
    });
    observation.pending = [baseIntent, unverifiable];

    const result = await runSolverPass(deps);

    if (result.kind !== 'RAN') throw new Error(result.kind);
    expect(result.outcomes.get(baseIntent.intentId)?.kind).toBe('FILLED');
    expect(result.outcomes.get(unverifiable.intentId)?.kind).toBe('UNVERIFIED');
    // Only the verified intent actually reached signing and submission.
    expect(submitter.submissions).toHaveLength(1);
  });

  it('an intent that makes processIntent throw is recorded as ERROR, not lost', async () => {
    // Same source and destination chain id: resolveRoute throws
    // SAME_CHAIN_ROUTE before processIntent ever reaches the fakes.
    const malformed = intent({
      intentId: '0x'.padEnd(66, 'f') as `0x${string}`,
      sourceChainId: SEPOLIA,
      destinationChainId: SEPOLIA,
    });
    observation.pending = [baseIntent, malformed];

    const result = await runSolverPass(deps);

    if (result.kind !== 'RAN') throw new Error(result.kind);
    expect(result.outcomes.size).toBe(2);
    expect(result.outcomes.get(baseIntent.intentId)?.kind).toBe('FILLED');
    const malformedOutcome = result.outcomes.get(malformed.intentId);
    expect(malformedOutcome?.kind).toBe('ERROR');
    if (malformedOutcome?.kind === 'ERROR') {
      expect(malformedOutcome.error).toBeInstanceOf(Error);
    }
    // The good intent still went through despite the other one throwing.
    expect(submitter.submissions).toHaveLength(1);
  });

  it('reports DISCOVERY_FAILED, and processes nothing, when pendingIntents itself fails', async () => {
    observation.pending = [baseIntent];
    observation.pendingIntentsFailWith = new Error('subgraph unreachable');

    const result = await runSolverPass(deps);

    expect(result.kind).toBe('DISCOVERY_FAILED');
    if (result.kind === 'DISCOVERY_FAILED') {
      expect(result.error.message).toBe('subgraph unreachable');
    }
    expect(submitter.submissions).toHaveLength(0);
    expect(sourceReader.calls).toHaveLength(0);
  });

  it('ARC as source works identically — direction is data, not a branch', async () => {
    const fromArc = intent({
      intentId: '0x'.padEnd(66, '9') as `0x${string}`,
      sourceChainId: ARC,
      destinationChainId: SEPOLIA,
      inputToken: '0x3600000000000000000000000000000000000000',
    });
    sourceReader.set(evidenceFor(fromArc, ARC_ROUTER));
    observation.pending = [fromArc];

    const result = await runSolverPass(deps);

    if (result.kind !== 'RAN') throw new Error(result.kind);
    expect(result.outcomes.get(fromArc.intentId)?.kind).toBe('FILLED');
    expect(submitter.submissions[0]).toMatchObject({ chainId: SEPOLIA, vault: SEPOLIA_VAULT });
  });
});
