import { describe, expect, it } from 'vitest';
import { InMemoryObservationProvider } from '../src/index.js';
import { health, intent, vault } from './fixtures.js';

describe('InMemoryObservationProvider', () => {
  it('serves recorded intents as pending', async () => {
    const provider = new InMemoryObservationProvider();
    provider.recordIntent(intent());

    expect(await provider.pendingIntents()).toHaveLength(1);
  });

  it('replaces rather than duplicates on re-record', async () => {
    const provider = new InMemoryObservationProvider();
    provider.recordIntent(intent({ amount: 1n }));
    provider.recordIntent(intent({ amount: 2n }));

    const pending = await provider.pendingIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.amount).toBe(2n);
  });

  it('drops filled intents from the pending set', async () => {
    const provider = new InMemoryObservationProvider();
    const i = intent();
    provider.recordIntent(i);
    provider.markFilled(i.intentId);

    expect(await provider.pendingIntents()).toHaveLength(0);
    expect(await provider.isFilled(i.intentId)).toBe(true);
  });

  it('matches intent ids case-insensitively', async () => {
    const provider = new InMemoryObservationProvider();
    const i = intent();
    provider.markFilled(i.intentId.toUpperCase() as `0x${string}`);

    expect(await provider.isFilled(i.intentId)).toBe(true);
  });

  it('serves vault state per chain', async () => {
    const provider = new InMemoryObservationProvider();
    provider.recordVaultState(vault({ chainId: 1 }));
    provider.recordVaultState(vault({ chainId: 2, totalBalance: 42n }));

    expect((await provider.vaultState(2)).totalBalance).toBe(42n);
  });

  /// A missing observation is a broken poller, not an empty vault. Returning
  /// zero liquidity would make it look like a policy decision instead.
  it('refuses rather than inventing an empty vault', async () => {
    const provider = new InMemoryObservationProvider();
    await expect(provider.vaultState(999)).rejects.toThrow(/No vault observation/);
  });

  it('refuses rather than inventing settlement health', async () => {
    const provider = new InMemoryObservationProvider();
    await expect(provider.settlementHealth()).rejects.toThrow(/No settlement health/);
  });

  it('serves the most recently recorded health', async () => {
    const provider = new InMemoryObservationProvider();
    provider.recordSettlementHealth(health({ transport: 'HEALTHY' }));
    provider.recordSettlementHealth(health({ transport: 'DEGRADED' }));

    expect((await provider.settlementHealth()).transport).toBe('DEGRADED');
  });

  /// The provider is a cache, so what it serves is whatever was last written —
  /// including a stale observation. That is the point: the solver must handle
  /// staleness locally rather than meeting it for the first time on The Graph.
  it('serves stale observations without complaint', async () => {
    const provider = new InMemoryObservationProvider();
    provider.recordVaultState(vault({ observedAt: 1_000 }));

    expect((await provider.vaultState(vault().chainId)).observedAt).toBe(1_000);
  });

  it('forgets an intent on request', async () => {
    const provider = new InMemoryObservationProvider();
    const i = intent();
    provider.recordIntent(i);
    provider.forget(i.intentId);

    expect(await provider.pendingIntents()).toHaveLength(0);
  });
});
