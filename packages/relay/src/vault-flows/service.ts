/**
 * Combines the participant registry (WP-21.1) with a `VaultFlowSource`
 * (WP-21.3) into what the Relay's own API route (WP-21.4) actually calls:
 * "every known flow event for this one vault, with any stranger's vault
 * filtered out before this ever returns." Re-derives the participant set on
 * every call rather than caching it across requests — this endpoint is not
 * expected to be hit often enough that re-querying the Nest each time is a
 * real cost, and a stale participant list would mean a vault that just won
 * its first fill stays invisible to this endpoint until some unrelated
 * refresh happens to run.
 */
import type { ParticipantRegistry } from '../participant-registry.js';
import { filterForVault, filterKnownParticipants } from './filter.js';
import type { VaultFlowEvent, VaultFlowSource } from './types.js';

export class VaultFlowsService {
  constructor(
    private readonly registry: ParticipantRegistry,
    private readonly source: VaultFlowSource,
  ) {}

  async vaultFlowsFor(vaultAddress: string): Promise<VaultFlowEvent[]> {
    await this.registry.refresh();
    const allEvents = await this.source.readVaultFlows();
    const knownOnly = filterKnownParticipants(allEvents, this.registry.participants());
    return filterForVault(knownOnly, vaultAddress);
  }
}
