/**
 * A local stand-in for The Graph.
 *
 * Deliberately a *cache*, not a live reader: it holds whatever was last written
 * into it and serves that. This is exactly the shape of the real thing — a
 * subgraph is a cache of chain state that lags by some amount — so the solver
 * sees the same class of data locally as it will in production, staleness
 * included.
 *
 * That matters more than it sounds. If the local provider read the chain
 * directly it would always be perfectly fresh, and the staleness handling the
 * risk engine relies on would never be exercised until The Graph arrived.
 */

import type {
  Bytes32,
  Intent,
  ObservationProvider,
  SettlementHealth,
  VaultState,
} from '@arcaidia/domain';

export class InMemoryObservationProvider implements ObservationProvider {
  private readonly intents = new Map<string, Intent>();
  private readonly vaults = new Map<number, VaultState>();
  private readonly filled = new Set<string>();
  private health: SettlementHealth | null = null;

  // --- what a poller writes ----------------------------------------------

  /** Record a discovered intent. Re-recording the same id replaces it. */
  recordIntent(intent: Intent): void {
    this.intents.set(key(intent.intentId), intent);
  }

  recordVaultState(state: VaultState): void {
    this.vaults.set(state.chainId, state);
  }

  recordSettlementHealth(health: SettlementHealth): void {
    this.health = health;
  }

  markFilled(intentId: Bytes32): void {
    this.filled.add(key(intentId));
  }

  /** Drop an intent from the pending set once it is no longer actionable. */
  forget(intentId: Bytes32): void {
    this.intents.delete(key(intentId));
  }

  // --- what the solver reads ----------------------------------------------

  async pendingIntents(): Promise<readonly Intent[]> {
    return [...this.intents.values()].filter((intent) => !this.filled.has(key(intent.intentId)));
  }

  async vaultState(chainId: number): Promise<VaultState> {
    const state = this.vaults.get(chainId);
    if (!state) {
      // Refusing beats returning an empty vault: a solver told there is no
      // liquidity would decline quietly, and a missing observation would look
      // like a policy decision rather than a broken poller.
      throw new Error(`No vault observation recorded for chain ${chainId}.`);
    }
    return state;
  }

  async settlementHealth(): Promise<SettlementHealth> {
    if (!this.health) throw new Error('No settlement health recorded.');
    return this.health;
  }

  async isFilled(intentId: Bytes32): Promise<boolean> {
    return this.filled.has(key(intentId));
  }
}

const key = (intentId: Bytes32): string => intentId.toLowerCase();
