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
  FakeTelemetryClient,
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
      intentVersion: i.intentVersion,
      tokenOut: i.tokenOut,
      targetMinOut: i.targetMinOut,
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
  /// WP-29: an operator's own vault must be where the fill goes, not just what it observed.
  it('submits to the vault this solver was configured with, not the committed House Vault', async () => {
    const own = '0x7777777777777777777777777777777777777777' as const;
    const outcome = await processIntent(baseIntent, { ...deps, vaults: new Map([[ARC, own]]) });
    expect(outcome.kind).toBe('FILLED');
    expect(submitter.submissions[0]!.vault).toBe(own);
    expect(authority.signed[0]!.domain.verifyingContract).toBe(own);
  });

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
    // Overriding to {} rather than resetDeployments(): the committed record
    // is real now (both chains deployed 2026-09-08), so simulating "not
    // deployed" needs an explicit empty override, not a fall-through to it.
    registerDeployment('ethereum-sepolia', {});
    registerDeployment('arc-testnet', {});
    await expect(processIntent(baseIntent, deps)).rejects.toThrow();
  });

  // -----------------------------------------------------------------------
  // Telemetry (WP-17.2) — pre-chain, purely observational, never load-bearing
  // -----------------------------------------------------------------------

  describe('telemetry', () => {
    it('reports all four pre-chain stages, in order, for a fill that completes', async () => {
      const telemetry = new FakeTelemetryClient();
      const outcome = await processIntent(baseIntent, { ...deps, telemetry });

      expect(outcome.kind).toBe('FILLED');
      expect(telemetry.stages.map((e) => e.stage)).toEqual([
        'INTENT_DISCOVERED',
        'VERIFYING_SOURCE',
        'FORMULATING_FILL',
        'SUBMITTING_SETTLEMENT',
      ]);
      expect(telemetry.stages.every((e) => e.intentId === baseIntent.intentId)).toBe(true);
      expect(telemetry.stages.every((e) => e.vaultAddress === ARC_VAULT)).toBe(true);
    });

    it('stops at FORMULATING_FILL for a declined intent — it never reaches submission', async () => {
      const telemetry = new FakeTelemetryClient();
      observation.vault = vault({ outstandingExposure: USDC(59_900) });

      const outcome = await processIntent(baseIntent, { ...deps, telemetry });

      expect(outcome.kind).toBe('DECLINED');
      expect(telemetry.stages.map((e) => e.stage)).toEqual([
        'INTENT_DISCOVERED',
        'VERIFYING_SOURCE',
        'FORMULATING_FILL',
      ]);
    });

    it('stops at VERIFYING_SOURCE for an intent that fails source verification', async () => {
      const telemetry = new FakeTelemetryClient();
      sourceReader.set({ ...evidenceFor(), status: 'reverted' });
      const outcome = await processIntent(baseIntent, { ...deps, telemetry });

      expect(outcome.kind).toBe('UNVERIFIED');
      expect(telemetry.stages.map((e) => e.stage)).toEqual([
        'INTENT_DISCOVERED',
        'VERIFYING_SOURCE',
      ]);
    });

    it('reports nothing for an intent this pass already knows is done', async () => {
      const telemetry = new FakeTelemetryClient();
      observation.filled.add(baseIntent.intentId);
      const outcome = await processIntent(baseIntent, { ...deps, telemetry });

      expect(outcome.kind).toBe('SKIPPED');
      expect(telemetry.stages).toHaveLength(0);
    });

    /// The actual WP-17 acceptance-gate claim, exercised directly: a telemetry
    /// client that throws synchronously on every call must not stop a fill
    /// from completing. `HttpTelemetryClient` is careful never to do this in
    /// the first place; this proves processIntent doesn't merely trust that.
    it('a telemetry client that throws on every call never breaks the fill', async () => {
      const hostileTelemetry = {
        reportStage: () => {
          throw new Error('relay is on fire');
        },
        heartbeat: () => {
          throw new Error('relay is on fire');
        },
      };

      const outcome = await processIntent(baseIntent, { ...deps, telemetry: hostileTelemetry });

      expect(outcome.kind).toBe('FILLED');
    });

    it('reports nothing when telemetry is entirely unset — TELEMETRY_ENABLED=false is correct, not just tolerated', async () => {
      const outcome = await processIntent(baseIntent, deps);
      expect(outcome.kind).toBe('FILLED');
    });
  });
});

// ---------------------------------------------------------------------------
// WP-28: optional ports — the swap adapter (D9) and ecosystem intelligence (WP-33)
// ---------------------------------------------------------------------------

describe('processIntent — optional swap adapter and intelligence', () => {
  const tradeIntent = intent({ tokenOut: '0x3333333333333333333333333333333333333333', targetMinOut: 5n });

  function depsFor(i = tradeIntent, extra: Partial<SolverDependencies> = {}): {
    deps: SolverDependencies;
    submitter: FakeSubmitter;
    log: InMemoryDecisionLog;
  } {
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
    const submitter = new FakeSubmitter();
    const log = new InMemoryDecisionLog();
    const deps: SolverDependencies = {
      observation: new FakeObservationProvider(vault(), health()),
      sourceReader: new FakeSourceReader(evidenceFor(i)),
      authority: new RecordingAuthority(),
      submitter,
      log,
      clock: () => NOW,
      nonces: new SequentialNonceSource(),
      journal: new InMemorySubmissionJournal(),
      config: { policy: DEFAULT_RISK_POLICY, authorizationTtlSeconds: 45 },
      ...extra,
    };
    return { deps, submitter, log };
  }

  afterEach(() => resetDeployments());

  it('the baseline solver (no adapter) declines every trade intent and leaves it to canonical USDC', async () => {
    const { deps, submitter } = depsFor();
    const outcome = await processIntent(tradeIntent, deps);
    expect(outcome.kind).toBe('DECLINED');
    if (outcome.kind !== 'DECLINED') throw new Error(outcome.kind);
    expect(outcome.decision.reason).toBe('TRADE_NOT_SUPPORTED');
    expect(submitter.submissions).toHaveLength(0);
  });

  it('fills a trade intent the adapter can satisfy, handing the vault the same intent it verified', async () => {
    const asked: unknown[] = [];
    const { deps, submitter } = depsFor(tradeIntent, {
      swapAdapter: {
        async quote() {
          return 10n;
        },
        async canSatisfy(chainId, tokenIn, tokenOut, amountIn, minOut) {
          asked.push([chainId, tokenIn, tokenOut, amountIn, minOut]);
          return true;
        },
      },
    });
    const outcome = await processIntent(tradeIntent, deps);
    expect(outcome.kind).toBe('FILLED');
    expect(asked).toEqual([[ARC, ARC_USDC, tradeIntent.tokenOut, tradeIntent.amount, 5n]]);
    expect(submitter.submissions[0]!.intent.tokenOut).toBe(tradeIntent.tokenOut);
  });

  it('declines when the adapter cannot meet the floor, and when it throws', async () => {
    for (const adapter of [
      { async quote() { return 0n; }, async canSatisfy() { return false; } },
      { async quote() { return 0n; }, async canSatisfy(): Promise<boolean> { throw new Error('rpc down'); } },
    ]) {
      const { deps } = depsFor(tradeIntent, { swapAdapter: adapter });
      const outcome = await processIntent(tradeIntent, deps);
      expect(outcome.kind).toBe('DECLINED');
      if (outcome.kind === 'DECLINED') expect(outcome.decision.reason).toBe('TRADE_NOT_SUPPORTED');
    }
  });

  it('never consults the adapter for a plain USDC transfer', async () => {
    let consulted = 0;
    const plain = intent();
    const { deps } = depsFor(plain, {
      swapAdapter: { async quote() { return 0n; }, async canSatisfy() { consulted++; return false; } },
    });
    expect((await processIntent(plain, deps)).kind).toBe('FILLED');
    expect(consulted).toBe(0);
  });

  const view = {
    aggregateAvailableLiquidity: USDC(250_000),
    aggregateUtilisationBps: 4_200,
    feeDistribution: { perVault: [], minBps: 10, medianBps: 25, maxBps: 60 },
    outstandingIntentVolume: USDC(12_000),
    pendingCctpExposure: USDC(30_000),
    recentFillVelocityPerHour: 14,
    recentSettlementLatency: { p50Seconds: 400, p95Seconds: 900, sampleSize: 20 },
    liquidityConcentrationBps: 3_300,
    estimatedOpportunitySize: USDC(25_000),
    scarcityScoreBps: 1_500,
    window: { fromSeconds: NOW - 3_600, toSeconds: NOW },
    computedAt: NOW,
    sourceBlocks: {},
  };

  it('records intelligence as narrative only — the verdict and numbers are the same with or without it', async () => {
    const plain = intent();
    const without = depsFor(plain);
    const withIt = depsFor(plain, { intelligence: { async ecosystem() { return view; } } });

    const a = await processIntent(plain, without.deps);
    const b = await processIntent(plain, withIt.deps);
    if (a.kind !== 'FILLED' || b.kind !== 'FILLED') throw new Error(`${a.kind} / ${b.kind}`);

    expect(b.decision.narrative).toMatch(/^ecosystem: liquidity 250000000000, utilisation 4200 bps, scarcity 1500 bps$/);
    expect(a.decision.narrative).toBeUndefined();
    const strip = (d: typeof a.decision) => ({ ...d, narrative: undefined });
    expect(strip(b.decision)).toEqual(strip(a.decision));
  });

  it('a failing intelligence provider changes nothing', async () => {
    const plain = intent();
    const { deps } = depsFor(plain, {
      intelligence: { async ecosystem(): Promise<typeof view> { throw new Error('402 unpaid'); } },
    });
    const outcome = await processIntent(plain, deps);
    expect(outcome.kind).toBe('FILLED');
    if (outcome.kind === 'FILLED') expect(outcome.decision.narrative).toBeUndefined();
  });
});
