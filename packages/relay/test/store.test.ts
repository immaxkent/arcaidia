import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { RelayStore } from '../src/store.js';
import type { VaultKey } from '../src/types.js';

const OPERATOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const OTHER_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as const;
const operator = privateKeyToAccount(OPERATOR_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const SEPOLIA: VaultKey = { chainId: 11155111, vaultAddress: '0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1' };
const ARC: VaultKey = { chainId: 5042002, vaultAddress: '0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1' };

const INTENT_ID = '0x'.padEnd(66, 'a') as `0x${string}`;

/** A real pairing round trip, used as setup by most tests below. */
async function pair(store: RelayStore, key: VaultKey, signer = operator): Promise<void> {
  const { challenge } = store.issueChallenge(key, signer.address);
  const signature = await signer.signMessage({ message: challenge });
  const ok = await store.confirmPairing(key, signer.address, challenge, signature);
  if (!ok) throw new Error('setup pairing unexpectedly failed');
}

describe('RelayStore pairing', () => {
  it('pairs given a valid challenge/response round trip', async () => {
    const store = new RelayStore();
    const { challenge } = store.issueChallenge(SEPOLIA, operator.address);
    const signature = await operator.signMessage({ message: challenge });

    expect(await store.confirmPairing(SEPOLIA, operator.address, challenge, signature)).toBe(true);

    const state = store.stateOf(SEPOLIA);
    expect(state.paired).toBe(true);
    expect(state.operatorAddress).toBe(operator.address.toLowerCase());
    // Pairing proves key possession only — it is not itself a heartbeat. See
    // the "awaiting solver vs offline" test below for why that distinction
    // has to survive pairing.
    expect(state.online).toBe(false);
    expect(state.lastHeartbeatAt).toBeNull();
  });

  it('rejects a signature from the wrong key', async () => {
    const store = new RelayStore();
    const { challenge } = store.issueChallenge(SEPOLIA, operator.address);
    const wrongSignature = await other.signMessage({ message: challenge });

    expect(await store.confirmPairing(SEPOLIA, operator.address, challenge, wrongSignature)).toBe(false);
    expect(store.stateOf(SEPOLIA).paired).toBe(false);
  });

  it('rejects a challenge string that was never issued', async () => {
    const store = new RelayStore();
    const signature = await operator.signMessage({ message: 'made-up-challenge' });

    expect(
      await store.confirmPairing(SEPOLIA, operator.address, 'made-up-challenge', signature),
    ).toBe(false);
  });

  it('rejects a stale challenge', async () => {
    let now = 1_000_000;
    const store = new RelayStore({ clock: () => now });
    const { challenge } = store.issueChallenge(SEPOLIA, operator.address);
    const signature = await operator.signMessage({ message: challenge });

    now += 301; // past the 300s TTL
    expect(await store.confirmPairing(SEPOLIA, operator.address, challenge, signature)).toBe(false);
  });

  /// The exact bug this design exists to prevent: two vaults sharing an
  /// address across chains (the House Vault does, today) must never be
  /// treated as the same vault.
  it('keys pairing by chain, not by address alone', async () => {
    const store = new RelayStore();
    await pair(store, SEPOLIA);

    expect(store.stateOf(SEPOLIA).paired).toBe(true);
    expect(store.stateOf(ARC).paired).toBe(false);
  });
});

describe('RelayStore heartbeat', () => {
  it('records a heartbeat for a paired vault', async () => {
    const store = new RelayStore();
    await pair(store, SEPOLIA);

    expect(store.recordHeartbeat(SEPOLIA, operator.address, 12_345)).toBe(true);
    expect(store.stateOf(SEPOLIA).lastHeartbeatAt).toBe(12_345);
  });

  it('refuses a heartbeat for a vault that never paired', () => {
    const store = new RelayStore();
    expect(store.recordHeartbeat(SEPOLIA, operator.address, 1)).toBe(false);
  });

  it("refuses a heartbeat from an operator other than the one who's paired", async () => {
    const store = new RelayStore();
    await pair(store, SEPOLIA, operator);

    expect(store.recordHeartbeat(SEPOLIA, other.address, 1)).toBe(false);
  });

  /// WP-18.2: no heartbeat within the window flips to offline; it must
  /// never flip a *different* vault's state as a side effect.
  it('flips exactly the timed-out vault to offline, and no other vault', async () => {
    let now = 1_000_000;
    const store = new RelayStore({ clock: () => now, heartbeatTimeoutSeconds: 30 });
    await pair(store, SEPOLIA);
    await pair(store, ARC);

    store.recordHeartbeat(SEPOLIA, operator.address, now);
    now += 131; // SEPOLIA is now 131s stale, well past the 30s window
    store.recordHeartbeat(ARC, operator.address, now); // ARC heartbeats right now — 0s stale

    store.sweepHeartbeats();

    expect(store.stateOf(SEPOLIA).online).toBe(false);
    expect(store.stateOf(ARC).online).toBe(true);
  });

  /// The two states WP-18.2 names are genuinely distinct: a vault that
  /// paired but has never sent a single heartbeat is "AWAITING SOLVER", not
  /// "SOLVER OFFLINE" — sweeping must never manufacture a heartbeat history
  /// (or an offline flip) for a vault that never had one.
  it('leaves a paired-but-never-heartbeat vault alone — that is AWAITING SOLVER, not OFFLINE', async () => {
    const store = new RelayStore({ clock: () => 1_000_000, heartbeatTimeoutSeconds: 30 });
    await pair(store, SEPOLIA);

    const before = store.stateOf(SEPOLIA);
    expect(before.paired).toBe(true);
    expect(before.online).toBe(false);
    expect(before.lastHeartbeatAt).toBeNull();

    store.sweepHeartbeats();

    expect(store.stateOf(SEPOLIA)).toEqual(before);
  });
});

describe('RelayStore stage events', () => {
  it('accepts a pre-chain stage from a paired operator', async () => {
    const store = new RelayStore();
    await pair(store, SEPOLIA);

    const result = store.recordStageEvent(SEPOLIA, 'INTENT_DISCOVERED', INTENT_ID, 500);
    expect(result.ok).toBe(true);

    const state = store.stateOf(SEPOLIA);
    expect(state.stage).toBe('INTENT_DISCOVERED');
    expect(state.stageAt).toBe(500);
    expect(state.intentId).toBe(INTENT_ID);
  });

  /// WP-18.3's own acceptance criterion: an onchain-confirmed stage must be
  /// rejected outright, never merely ignored or logged.
  it('rejects an onchain-confirmed stage claimed over telemetry', async () => {
    const store = new RelayStore();
    await pair(store, SEPOLIA);

    const result = store.recordStageEvent(SEPOLIA, 'FAST_FILL_CONFIRMED', INTENT_ID, 500);

    expect(result).toEqual({ ok: false, reason: 'UNACCEPTED_STAGE' });
    expect(store.stateOf(SEPOLIA).stage).toBeNull();
  });

  it('rejects any stage when the vault has never paired', () => {
    const store = new RelayStore();
    const result = store.recordStageEvent(SEPOLIA, 'INTENT_DISCOVERED', INTENT_ID, 500);

    expect(result).toEqual({ ok: false, reason: 'NOT_PAIRED' });
  });

  it('a stage event also counts as liveness', async () => {
    const store = new RelayStore();
    await pair(store, SEPOLIA);

    store.recordStageEvent(SEPOLIA, 'FORMULATING_FILL', INTENT_ID, 999);
    expect(store.stateOf(SEPOLIA).lastHeartbeatAt).toBe(999);
  });
});

describe('RelayStore subscription — cross-vault isolation', () => {
  it('never delivers one vault\'s update to a subscriber of a different vault', async () => {
    const store = new RelayStore();
    await pair(store, SEPOLIA);
    await pair(store, ARC);

    const sepoliaUpdates: unknown[] = [];
    const arcUpdates: unknown[] = [];
    store.subscribe(SEPOLIA, (state) => sepoliaUpdates.push(state));
    store.subscribe(ARC, (state) => arcUpdates.push(state));

    store.recordHeartbeat(SEPOLIA, operator.address, 42);

    expect(sepoliaUpdates).toHaveLength(1);
    expect(arcUpdates).toHaveLength(0);
  });

  it('an unsubscribed listener receives nothing further', async () => {
    const store = new RelayStore();
    await pair(store, SEPOLIA);

    const updates: unknown[] = [];
    const unsubscribe = store.subscribe(SEPOLIA, (state) => updates.push(state));
    unsubscribe();

    store.recordHeartbeat(SEPOLIA, operator.address, 1);
    expect(updates).toHaveLength(0);
  });

  it('a never-seen vault reports a well-formed empty state, not an error', () => {
    const store = new RelayStore();
    expect(store.stateOf(SEPOLIA)).toEqual({
      chainId: SEPOLIA.chainId,
      vaultAddress: SEPOLIA.vaultAddress.toLowerCase(),
      operatorAddress: null,
      paired: false,
      online: false,
      lastHeartbeatAt: null,
      stage: null,
      stageAt: null,
      intentId: null,
    });
  });
});
