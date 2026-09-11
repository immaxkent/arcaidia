/**
 * WP-21.1 — "buildable v1" participant discovery. `ArcaidiaIntentMarket` has
 * no vault registry (no `registerVault()`, no `VaultRegistered` event — see
 * WP-21's own doc), so the only real signal available today is *which
 * addresses have ever appeared as the winning `vault` in a fastFill*. This
 * queries the same Nest table `use-vaults.ts`'s identical frontend discovery
 * already reads (`SELECT DISTINCT vault FROM fills`).
 *
 * Known limitation, stated plainly, not hidden: a vault that has joined the
 * market but never yet won a single race is invisible here until it does.
 * Acceptable for v1 — see WP-21.2 for the real fix (on-chain registration),
 * not built here.
 */
import type { NestQueryClient } from './nest-client.js';

export class ParticipantRegistry {
  private participantSet = new Set<string>();

  constructor(
    private readonly nestEndpoint: string,
    private readonly client: NestQueryClient,
  ) {}

  /** Re-derives the known-participant set from the Nest's current fill history. */
  async refresh(): Promise<void> {
    const result = await this.client.query<{ vault: string }>(this.nestEndpoint, 'SELECT DISTINCT vault FROM fills');
    this.participantSet = new Set(result.rows.map((row) => row.vault.toLowerCase()));
  }

  isParticipant(vaultAddress: string): boolean {
    return this.participantSet.has(vaultAddress.toLowerCase());
  }

  participants(): ReadonlySet<string> {
    return this.participantSet;
  }
}
