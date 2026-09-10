import { describe, expect, it } from 'vitest';
import { DecisionReason, Verdict } from '@arcaidia/domain';
import {
  DEFAULT_RISK_POLICY,
  GraphObservationProvider,
  InMemoryObservationProvider,
  evaluateIntent,
  type EvmContractReadClient,
  type GraphQueryClient,
} from '../src/index.js';
import { ARC, NOW, SEPOLIA, USDC, context, health, intent, vault } from './fixtures.js';

const SEPOLIA_ENDPOINT = 'https://example.invalid/sepolia';
const ARC_ENDPOINT = 'https://example.invalid/arc';
const SEPOLIA_VAULT = '0x2222222222222222222222222222222222222222';
const ARC_VAULT = '0x5555555555555555555555555555555555555555';

/** Serves canned responses per endpoint, and records what was asked. */
class FakeGraph implements GraphQueryClient {
  calls: Array<{ endpoint: string; document: string }> = [];
  failWith: Error | null = null;

  constructor(
    private readonly responses: Record<string, Record<string, unknown>> = {},
  ) {}

  set(endpoint: string, key: string, value: unknown): void {
    this.responses[endpoint] = { ...(this.responses[endpoint] ?? {}), [key]: value };
  }

  async query<T>(endpoint: string, document: string): Promise<T> {
    this.calls.push({ endpoint, document });
    if (this.failWith) throw this.failWith;

    const forEndpoint = this.responses[endpoint] ?? {};
    const _meta = forEndpoint.meta ?? { block: { timestamp: String(NOW) } };
    if (document.includes('PendingIntents')) return { intents: forEndpoint.intents ?? [] } as T;
    if (document.includes('VaultState')) {
      return { vault: forEndpoint.vault ?? null, _meta } as T;
    }
    if (document.includes('ProtocolState')) {
      return { protocolState: forEndpoint.protocolState ?? null, _meta } as T;
    }
    if (document.includes('FillForIntent')) return { fills: forEndpoint.fills ?? [] } as T;
    throw new Error(`unexpected query: ${document.slice(0, 40)}`);
  }
}

/**
 * Vault config as read directly from the chain. Defaults match
 * `fixtures.vault()`'s own defaults, so tests exercising the subgraph fields
 * keep getting the ACCEPT they always got; a test can override a chain's
 * figures to exercise the vault's own caps specifically.
 */
class FakeContractReads implements EvmContractReadClient {
  private readonly overrides = new Map<string, bigint>();

  constructor(
    private readonly defaults: {
      reserveFloor: bigint;
      maxFillAmount: bigint;
      maxOutstandingExposure: bigint;
      totalSupply: bigint;
    } = {
      reserveFloor: USDC(10_000),
      maxFillAmount: USDC(25_000),
      maxOutstandingExposure: USDC(60_000),
      totalSupply: USDC(100_000),
    },
  ) {}

  set(functionName: string, value: bigint): void {
    this.overrides.set(functionName, value);
  }

  async readContract(args: { functionName: string }): Promise<unknown> {
    if (this.overrides.has(args.functionName)) return this.overrides.get(args.functionName);
    const key = args.functionName as keyof typeof this.defaults;
    if (key in this.defaults) return this.defaults[key];
    throw new Error(`unexpected readContract call: ${args.functionName}`);
  }
}

const rawIntent = (overrides: Record<string, unknown> = {}) => ({
  id: '0x'.padEnd(66, 'a'),
  sender: '0x1111111111111111111111111111111111111111',
  recipient: '0x2222222222222222222222222222222222222222',
  inputToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  amount: '1000000000',
  sourceChainId: String(SEPOLIA),
  destinationChainId: String(ARC),
  maxFeeBps: 100,
  deadline: String(NOW + 3600),
  nonce: '1',
  settlementRef: '0x'.padEnd(66, 'c'),
  createdAtBlock: '100',
  createdAtTimestamp: String(NOW - 60),
  createdTxHash: '0x'.padEnd(66, 'b'),
  ...overrides,
});

const rawVault = (overrides: Record<string, unknown> = {}) => ({
  id: ARC_VAULT,
  chainId: String(ARC),
  asset: '0x3600000000000000000000000000000000000000',
  liquidBalance: '100000000000',
  outstandingExposure: '0',
  accruedProtocolFees: '0',
  paused: false,
  updatedAtBlock: '500',
  updatedAtTimestamp: String(NOW),
  ...overrides,
});

function provider(
  graph: FakeGraph,
  clock = () => NOW,
  reads: { sepolia?: FakeContractReads; arc?: FakeContractReads } = {},
): GraphObservationProvider {
  return new GraphObservationProvider({
    sources: [
      { chainId: SEPOLIA, endpoint: SEPOLIA_ENDPOINT, vault: SEPOLIA_VAULT },
      { chainId: ARC, endpoint: ARC_ENDPOINT, vault: ARC_VAULT },
    ],
    client: graph,
    readClients: new Map([
      [SEPOLIA, reads.sepolia ?? new FakeContractReads()],
      [ARC, reads.arc ?? new FakeContractReads()],
    ]),
    clock,
  });
}

describe('GraphObservationProvider', () => {
  // -----------------------------------------------------------------------
  // Discovery and the cross-chain merge
  // -----------------------------------------------------------------------

  it('queries every configured chain', async () => {
    const graph = new FakeGraph();
    await provider(graph).pendingIntents();

    const endpoints = new Set(graph.calls.map((c) => c.endpoint));
    expect(endpoints).toContain(SEPOLIA_ENDPOINT);
    expect(endpoints).toContain(ARC_ENDPOINT);
  });

  it('returns intents discovered on either chain', async () => {
    const graph = new FakeGraph();
    graph.set(SEPOLIA_ENDPOINT, 'intents', [rawIntent()]);
    graph.set(ARC_ENDPOINT, 'intents', [
      rawIntent({ id: '0x'.padEnd(66, 'd'), sourceChainId: String(ARC), destinationChainId: String(SEPOLIA) }),
    ]);

    expect(await provider(graph).pendingIntents()).toHaveLength(2);
  });

  it('decodes an intent into the shared domain shape', async () => {
    const graph = new FakeGraph();
    graph.set(SEPOLIA_ENDPOINT, 'intents', [rawIntent()]);

    const [decoded] = await provider(graph).pendingIntents();
    expect(decoded).toMatchObject({
      amount: USDC(1_000),
      sourceChainId: SEPOLIA,
      destinationChainId: ARC,
      nonce: 1n,
    });
  });

  /// An intent is created on one chain and filled on the other, so a source
  /// subgraph cannot know its own intents have been filled. The merge is what
  /// stops the solver being handed work that is already done.
  it('excludes intents the other chain has already filled', async () => {
    const graph = new FakeGraph();
    graph.set(SEPOLIA_ENDPOINT, 'intents', [rawIntent()]);
    graph.set(ARC_ENDPOINT, 'fills', [{ id: '0xfill' }]);

    expect(await provider(graph).pendingIntents()).toHaveLength(0);
  });

  it('reports an intent as filled when either chain has a fill for it', async () => {
    const graph = new FakeGraph();
    graph.set(ARC_ENDPOINT, 'fills', [{ id: '0xfill' }]);

    expect(await provider(graph).isFilled('0x'.padEnd(66, 'a') as `0x${string}`)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Staleness — the decision that makes the lag visible
  // -----------------------------------------------------------------------

  /// A subgraph is a cache that lags. Stamping observations with the local
  /// clock would make one an hour behind look perfectly fresh, and the risk
  /// engine's staleness guard would never fire.
  it("takes observedAt from the subgraph's own indexing head, not from the local clock", async () => {
    const graph = new FakeGraph();
    graph.set(ARC_ENDPOINT, 'vault', rawVault());
    graph.set(ARC_ENDPOINT, 'meta', { block: { timestamp: String(NOW - 3_600) } });

    const state = await provider(graph, () => NOW).vaultState(ARC);
    expect(state.observedAt).toBe(NOW - 3_600);
  });

  it('lets a lagging subgraph be rejected as stale by the risk engine', async () => {
    const graph = new FakeGraph();
    graph.set(ARC_ENDPOINT, 'vault', rawVault());
    graph.set(ARC_ENDPOINT, 'meta', { block: { timestamp: String(NOW - 600) } });

    const state = await provider(graph).vaultState(ARC);
    const decision = evaluateIntent(intent(), state, health(), DEFAULT_RISK_POLICY, context());

    expect(decision.verdict).toBe(Verdict.REJECT);
    expect(decision.reason).toBe(DecisionReason.OBSERVATION_STALE);
  });

  /// The bug this fixed: a vault entity's own `updatedAtTimestamp` only tracks
  /// indexer lag when the vault is mutated at least as often as the staleness
  /// window. A vault with no deposits/fills for an hour is not a lagging
  /// indexer — it's a quiet vault — and must not be rejected as stale for it.
  it('does not reject a quiet-but-current vault as stale', async () => {
    const graph = new FakeGraph();
    graph.set(ARC_ENDPOINT, 'vault', rawVault({ updatedAtTimestamp: String(NOW - 3_600) }));
    graph.set(ARC_ENDPOINT, 'meta', { block: { timestamp: String(NOW) } });

    const state = await provider(graph, () => NOW).vaultState(ARC);
    const decision = evaluateIntent(intent(), state, health(), DEFAULT_RISK_POLICY, context());

    expect(state.observedAt).toBe(NOW);
    expect(decision.reason).not.toBe(DecisionReason.OBSERVATION_STALE);
  });

  it('carries vault figures through unchanged', async () => {
    const graph = new FakeGraph();
    graph.set(
      ARC_ENDPOINT,
      'vault',
      rawVault({ liquidBalance: '90000000000', outstandingExposure: '10000000000', accruedProtocolFees: '500000' }),
    );

    const state = await provider(graph).vaultState(ARC);
    expect(state.totalBalance).toBe(USDC(90_000));
    expect(state.outstandingExposure).toBe(USDC(10_000));
    expect(state.accruedProtocolFees).toBe(500_000n);
  });

  /// The 2026-09-10 bug: reserveFloor/maxFillAmount/maxOutstandingExposure are
  /// vault *config*, never indexed by the subgraph, and were previously
  /// hardcoded to 0 / never read at all. They must come from the chain.
  it('reads reserveFloor, maxFillAmount and maxOutstandingExposure directly from the chain', async () => {
    const graph = new FakeGraph();
    graph.set(ARC_ENDPOINT, 'vault', rawVault());

    const reads = new FakeContractReads();
    reads.set('reserveFloor', USDC(5_000));
    reads.set('maxFillAmount', USDC(12_000));
    reads.set('maxOutstandingExposure', USDC(30_000));

    const state = await provider(graph, () => NOW, { arc: reads }).vaultState(ARC);

    expect(state.reserveFloor).toBe(USDC(5_000));
    expect(state.maxFillAmount).toBe(USDC(12_000));
    expect(state.maxOutstandingExposure).toBe(USDC(30_000));
  });

  /// The exact bug reported live: a $100 vault quoting ACCEPT for a $100 fill
  /// because the risk engine checked only the policy's own flat ceiling
  /// (USDC(25_000) — vastly higher than this vault could ever support) and
  /// never the vault's real, live, percentage-based cap. The vault's cap must
  /// govern even when the policy's separate ceiling would allow the fill.
  it("rejects a fill the vault's real cap would reject, even though the policy's own ceiling allows it", async () => {
    const graph = new FakeGraph();
    graph.set(ARC_ENDPOINT, 'vault', rawVault({ liquidBalance: String(USDC(100)) }));

    const reads = new FakeContractReads();
    reads.set('reserveFloor', 0n);
    reads.set('maxFillAmount', USDC(50)); // 50% of a $100 vault
    reads.set('maxOutstandingExposure', USDC(80));

    const state = await provider(graph, () => NOW, { arc: reads }).vaultState(ARC);
    const decision = evaluateIntent(
      intent({ amount: USDC(100) }), // well within the policy's own USDC(25_000) ceiling
      state,
      health(),
      DEFAULT_RISK_POLICY,
      context(),
    );

    expect(decision.verdict).toBe(Verdict.REJECT);
    expect(decision.reason).toBe(DecisionReason.INTENT_SIZE_CAP_BREACH);
  });

  // -----------------------------------------------------------------------
  // Settlement health
  // -----------------------------------------------------------------------

  it('sums pending settlement value across chains', async () => {
    const graph = new FakeGraph();
    const state = { intentsFilled: '1', intentsSettled: '0', updatedAtTimestamp: String(NOW) };
    graph.set(SEPOLIA_ENDPOINT, 'protocolState', { ...state, pendingSettlementValue: '1000000000', oldestUnsettledTimestamp: String(NOW - 100) });
    graph.set(ARC_ENDPOINT, 'protocolState', { ...state, pendingSettlementValue: '2000000000', oldestUnsettledTimestamp: String(NOW - 500) });

    const health_ = await provider(graph).settlementHealth();
    expect(health_.pendingValue).toBe(USDC(3_000));
    expect(health_.oldestUnsettledAgeSeconds).toBe(500);
  });

  it('reports no outstanding age when nothing is pending', async () => {
    const graph = new FakeGraph();
    graph.set(SEPOLIA_ENDPOINT, 'protocolState', {
      pendingSettlementValue: '0', oldestUnsettledTimestamp: '0',
      intentsFilled: '0', intentsSettled: '0', updatedAtTimestamp: String(NOW),
    });

    expect((await provider(graph).settlementHealth()).oldestUnsettledAgeSeconds).toBeNull();
  });

  /// The indexer answering says nothing about whether Circle is healthy. That
  /// is the settlement worker's observation, and this provider must not claim
  /// knowledge it does not have.
  it('does not claim to know the canonical transport is healthy or not', async () => {
    const graph = new FakeGraph();
    const health_ = await provider(graph).settlementHealth();

    expect(health_.transport).toBe('HEALTHY');
    expect(health_.averageSettlementLatencySeconds).toBeNull();
    expect(health_.latencySampleSize).toBe(0);
  });

  // -----------------------------------------------------------------------
  // When The Graph is down
  // -----------------------------------------------------------------------

  /// Answering "no pending intents" during an outage would report a quiet day
  /// rather than a failure, and the solver would idle while work piled up.
  it('throws rather than reporting an empty world', async () => {
    const graph = new FakeGraph();
    graph.failWith = new Error('502 Bad Gateway');

    await expect(provider(graph).pendingIntents()).rejects.toThrow(/502/);
    await expect(provider(graph).vaultState(ARC)).rejects.toThrow(/502/);
    await expect(provider(graph).settlementHealth()).rejects.toThrow(/502/);
    await expect(provider(graph).isFilled('0x'.padEnd(66, 'a') as `0x${string}`)).rejects.toThrow();
  });

  it('recovers once the endpoint returns', async () => {
    const graph = new FakeGraph();
    graph.set(SEPOLIA_ENDPOINT, 'intents', [rawIntent()]);

    graph.failWith = new Error('down');
    await expect(provider(graph).pendingIntents()).rejects.toThrow();

    graph.failWith = null;
    expect(await provider(graph).pendingIntents()).toHaveLength(1);
  });

  /// A vault the subgraph has never indexed is a broken deployment, not an
  /// empty one. Reporting zero liquidity would make the solver decline quietly.
  it('refuses rather than inventing an unindexed vault', async () => {
    const graph = new FakeGraph();
    await expect(provider(graph).vaultState(ARC)).rejects.toThrow(/No indexed vault/);
  });

  it('refuses a chain it has no subgraph for', async () => {
    await expect(provider(new FakeGraph()).vaultState(999)).rejects.toThrow(/No subgraph configured/);
  });
});

// ---------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------

describe('provider parity', () => {
  /// The strongest evidence the adapter boundary held: given equivalent
  /// underlying state, the two providers must produce the same decision. If
  /// they diverged, swapping one for the other would change the solver's
  /// behaviour — and the whole substitution strategy would be unsound.
  it('produces the same decision as the in-memory provider', async () => {
    const graph = new FakeGraph();
    graph.set(ARC_ENDPOINT, 'vault', rawVault());

    const fromGraph = await provider(graph).vaultState(ARC);

    const memory = new InMemoryObservationProvider();
    memory.recordVaultState({ ...fromGraph });
    const fromMemory = await memory.vaultState(ARC);

    const viaGraph = evaluateIntent(intent(), fromGraph, health(), DEFAULT_RISK_POLICY, context());
    const viaMemory = evaluateIntent(intent(), fromMemory, health(), DEFAULT_RISK_POLICY, context());

    expect(viaGraph).toEqual(viaMemory);
    expect(viaGraph.verdict).toBe(Verdict.ACCEPT);
  });

  /// And the case that matters for the bounty: live aggregate state, visible
  /// only through the subgraph, changing what the solver is willing to do.
  it('lets live Graph state turn an accept into a reject', async () => {
    const graph = new FakeGraph();
    graph.set(ARC_ENDPOINT, 'vault', rawVault());
    graph.set(SEPOLIA_ENDPOINT, 'protocolState', {
      pendingSettlementValue: '50000000000', // beyond the backlog policy
      oldestUnsettledTimestamp: String(NOW - 100),
      intentsFilled: '40', intentsSettled: '0', updatedAtTimestamp: String(NOW),
    });

    const p = provider(graph);
    const vaultState = await p.vaultState(ARC);

    const quiet = evaluateIntent(intent(), vaultState, health(), DEFAULT_RISK_POLICY, context());
    const busy = evaluateIntent(
      intent(), vaultState, await p.settlementHealth(), DEFAULT_RISK_POLICY, context(),
    );

    expect(quiet.verdict).toBe(Verdict.ACCEPT);
    expect(busy.verdict).toBe(Verdict.REJECT);
    expect(busy.reason).toBe(DecisionReason.SETTLEMENT_BACKLOG);
  });
});
