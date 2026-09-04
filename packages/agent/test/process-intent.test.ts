import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Verdict, registerDeployment, resetDeployments } from '@arcaidia/domain';
import {
  DEFAULT_RISK_POLICY,
  InMemorySubmissionJournal,
  SequentialNonceSource,
  processIntent,
  type SolverDependencies,
} from '../src/index.js';
import { InMemoryDecisionLog } from '../src/logging/decision-log.js';
import type { SourceEvidence } from '../src/verification/source-evidence.js';
import { ARC, NOW, SEPOLIA, USDC, health, intent, vault } from './fixtures.js';
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

/** Arc's ERC-20 facade over its native USDC gas token. */
const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;

const baseIntent = intent();

function evidenceFor(i = baseIntent): SourceEvidence {
  return {
    txHash: i.sourceTxHash,
    status: 'success',
    to: i.sourceChainId === SEPOLIA ? SEPOLIA_ROUTER : ARC_ROUTER,
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
      emitter: i.sourceChainId === SEPOLIA ? SEPOLIA_ROUTER : ARC_ROUTER,
    },
  };
}

describe('processIntent', () => {
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

  // -----------------------------------------------------------------------
  // The happy path
  // -----------------------------------------------------------------------

  it('verifies, decides, signs and submits', async () => {
    const outcome = await processIntent(baseIntent, deps);

    expect(outcome.kind).toBe('FILLED');
    expect(sourceReader.calls).toHaveLength(1);
    expect(authority.signed).toHaveLength(1);
    expect(submitter.submissions).toHaveLength(1);
  });

  it('signs an authorization matching the decision', async () => {
    const outcome = await processIntent(baseIntent, deps);
    if (outcome.kind !== 'FILLED') throw new Error(outcome.kind);

    const signedAuth = authority.signed[0]!.authorization;
    expect(signedAuth.intentId).toBe(baseIntent.intentId);
    expect(signedAuth.recipient).toBe(baseIntent.recipient);
    expect(signedAuth.inputAmount).toBe(baseIntent.amount);
    expect(signedAuth.outputAmount).toBe(outcome.decision.outputAmount);
    expect(signedAuth.feeAmount).toBe(outcome.decision.feeAmount);
    expect(signedAuth.outputAmount + signedAuth.feeAmount).toBe(baseIntent.amount);
  });

  it('gives the authorization a short expiry', async () => {
    await processIntent(baseIntent, deps);
    expect(authority.signed[0]!.authorization.expiry).toBe(NOW + 45);
  });

  /// Direction is data: the destination vault is resolved from the intent's own
  /// chain ids, not from a branch.
  it('signs against the destination chain and its vault', async () => {
    await processIntent(baseIntent, deps);
    expect(authority.signed[0]!.domain).toEqual({
      chainId: ARC,
      verifyingContract: ARC_VAULT,
    });
  });

  it('submits to the destination vault', async () => {
    await processIntent(baseIntent, deps);
    expect(submitter.submissions[0]).toMatchObject({ chainId: ARC, vault: ARC_VAULT });
  });

  /// The same function, the same assertions, chains swapped. If this needed a
  /// second code path the design would have failed.
  it('handles the mirrored direction identically', async () => {
    // Mirroring swaps the settlement asset too: funds now originate on Arc, so
    // the intent is denominated in Arc's USDC. Verification checks the asset
    // against the *source* chain's configuration, so an intent that only
    // swapped chain ids would rightly be refused.
    const mirrored = intent({
      sourceChainId: ARC,
      destinationChainId: SEPOLIA,
      inputToken: ARC_USDC,
    });
    sourceReader.set(evidenceFor(mirrored));

    const outcome = await processIntent(mirrored, deps);

    expect(outcome.kind).toBe('FILLED');
    expect(authority.signed[0]!.domain).toEqual({
      chainId: SEPOLIA,
      verifyingContract: SEPOLIA_VAULT,
    });
    expect(submitter.submissions[0]).toMatchObject({ chainId: SEPOLIA, vault: SEPOLIA_VAULT });
  });

  // -----------------------------------------------------------------------
  // Verification gates signing
  // -----------------------------------------------------------------------

  /// Nothing may be signed on evidence that did not check out. This is the
  /// whole reason verification runs before evaluation.
  it('signs nothing when source verification fails', async () => {
    sourceReader.set({ ...evidenceFor(), status: 'reverted' });

    const outcome = await processIntent(baseIntent, deps);

    expect(outcome).toMatchObject({ kind: 'UNVERIFIED', code: ErrorCode.SOURCE_TX_REVERTED });
    expect(authority.signed).toHaveLength(0);
    expect(submitter.submissions).toHaveLength(0);
  });

  it('rejects evidence from a contract that is not the configured router', async () => {
    sourceReader.set({ ...evidenceFor(), to: '0x9999999999999999999999999999999999999999' });

    const outcome = await processIntent(baseIntent, deps);
    expect(outcome).toMatchObject({ kind: 'UNVERIFIED', code: ErrorCode.SOURCE_ROUTER_MISMATCH });
  });

  it('does not consult the vault before the source is verified', async () => {
    sourceReader.set({ ...evidenceFor(), status: null });
    await processIntent(baseIntent, deps);
    expect(observation.vaultStateCalls).toBe(0);
  });

  // -----------------------------------------------------------------------
  // The decision gates signing
  // -----------------------------------------------------------------------

  it('signs nothing when the agent declines', async () => {
    observation.vault = vault({ outstandingExposure: USDC(59_900) });

    const outcome = await processIntent(baseIntent, deps);

    expect(outcome.kind).toBe('DECLINED');
    if (outcome.kind === 'DECLINED') expect(outcome.decision.verdict).toBe(Verdict.REJECT);
    expect(authority.signed).toHaveLength(0);
  });

  it('signs nothing when the agent pauses', async () => {
    observation.health = health({ transport: 'UNAVAILABLE' });

    const outcome = await processIntent(baseIntent, deps);

    expect(outcome.kind).toBe('DECLINED');
    if (outcome.kind === 'DECLINED') expect(outcome.decision.verdict).toBe(Verdict.PAUSE);
    expect(submitter.submissions).toHaveLength(0);
  });

  /// A log written only on success would hide exactly the runs worth
  /// investigating.
  it('records a decision even when it declines', async () => {
    observation.health = health({ transport: 'UNAVAILABLE' });
    await processIntent(baseIntent, deps);

    expect(log.all()).toHaveLength(1);
    expect(log.all()[0]?.verdict).toBe(Verdict.PAUSE);
  });

  it('records the decision behind a fill', async () => {
    await processIntent(baseIntent, deps);
    expect(log.forIntent(baseIntent.intentId)).toHaveLength(1);
    expect(log.all()[0]?.verdict).toBe(Verdict.ACCEPT);
  });

  // -----------------------------------------------------------------------
  // Idempotency
  // -----------------------------------------------------------------------

  it('skips an intent the chain reports as already filled', async () => {
    observation.filled.add(baseIntent.intentId.toLowerCase());

    const outcome = await processIntent(baseIntent, deps);

    expect(outcome).toEqual({ kind: 'SKIPPED', reason: 'ALREADY_FILLED' });
    expect(sourceReader.calls).toHaveLength(0);
    expect(authority.signed).toHaveLength(0);
  });

  it('skips an intent this process already attempted', async () => {
    await processIntent(baseIntent, deps);
    const second = await processIntent(baseIntent, deps);

    expect(second).toEqual({ kind: 'SKIPPED', reason: 'ALREADY_ATTEMPTED' });
    expect(submitter.submissions).toHaveLength(1);
  });

  /// A transaction that lands after a timeout still moved funds, so the journal
  /// is marked before submission rather than after.
  it('does not retry after a failed submission', async () => {
    submitter.failWith = new Error('timeout');

    const first = await processIntent(baseIntent, deps);
    expect(first.kind).toBe('SUBMISSION_FAILED');

    const second = await processIntent(baseIntent, deps);
    expect(second).toEqual({ kind: 'SKIPPED', reason: 'ALREADY_ATTEMPTED' });
  });

  it('reports a submission failure with its decision and signature intact', async () => {
    submitter.failWith = new Error('nonce too low');
    const outcome = await processIntent(baseIntent, deps);

    if (outcome.kind !== 'SUBMISSION_FAILED') throw new Error(outcome.kind);
    expect(outcome.error.message).toBe('nonce too low');
    expect(outcome.decision.verdict).toBe(Verdict.ACCEPT);
    expect(outcome.signed.signer).toBe(authority.address);
  });

  // -----------------------------------------------------------------------
  // Nonces
  // -----------------------------------------------------------------------

  it('uses a fresh agent nonce per authorization', async () => {
    await processIntent(baseIntent, deps);
    await processIntent(intent({ intentId: '0x'.padEnd(66, 'd') as `0x${string}`, nonce: 2n }), deps);

    const nonces = authority.signed.map((entry) => entry.authorization.nonce);
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  it('refuses a route whose contracts are not deployed', async () => {
    resetDeployments();
    await expect(processIntent(baseIntent, deps)).rejects.toThrow();
  });
});
