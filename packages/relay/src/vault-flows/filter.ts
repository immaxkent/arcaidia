/**
 * WP-21.3's core, pure logic — filtering is deliberately separate from
 * *where* events came from (`VaultFlowSource`) or *who* counts as a
 * participant (`ParticipantRegistry`), so this one function is what every
 * test in this package proves directly, without a fixture file or a network
 * call in the way.
 */
import type { VaultFlowEvent } from './types.js';

/**
 * Keeps only events from vaults in `participants` — a stranger's vault
 * deposit is discarded outright, never exposed, even though the underlying
 * Substreams module deliberately watches every conforming vault on chain.
 */
export function filterKnownParticipants(
  events: readonly VaultFlowEvent[],
  participants: ReadonlySet<string>,
): VaultFlowEvent[] {
  return events.filter((event) => participants.has(event.vault.toLowerCase()));
}

/** Further narrows to one specific vault — what the `/v1/vault-flows/{vault}` endpoint actually serves. */
export function filterForVault(events: readonly VaultFlowEvent[], vaultAddress: string): VaultFlowEvent[] {
  const target = vaultAddress.toLowerCase();
  return events.filter((event) => event.vault.toLowerCase() === target);
}
