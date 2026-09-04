import type {
  AgentAuthority,
  Bytes32,
  FillAuthorization,
  Intent,
  ObservationProvider,
  SettlementHealth,
  SignedFillAuthorization,
  TxHash,
  VaultState,
} from '@arcaidia/domain';
import type { SourceChainReader, SourceEvidence } from '../src/verification/source-evidence.js';
import type { FillSubmitter } from '../src/solver/ports.js';

/**
 * Fakes for the solver's ports.
 *
 * Deliberately dumb: they return what they are told to and record what they
 * were asked. The point of the suite is the orchestration's ordering and its
 * refusals, so any cleverness here would be testing the fake.
 */

export class FakeObservationProvider implements ObservationProvider {
  filled = new Set<string>();
  vault: VaultState;
  health: SettlementHealth;
  vaultStateCalls = 0;

  constructor(vault: VaultState, health: SettlementHealth) {
    this.vault = vault;
    this.health = health;
  }

  async pendingIntents(): Promise<readonly Intent[]> {
    return [];
  }

  async vaultState(): Promise<VaultState> {
    this.vaultStateCalls += 1;
    return this.vault;
  }

  async settlementHealth(): Promise<SettlementHealth> {
    return this.health;
  }

  async isFilled(intentId: Bytes32): Promise<boolean> {
    return this.filled.has(intentId.toLowerCase());
  }
}

export class FakeSourceReader implements SourceChainReader {
  calls: Array<{ chainId: number; txHash: TxHash }> = [];

  constructor(private evidence: SourceEvidence) {}

  set(evidence: SourceEvidence): void {
    this.evidence = evidence;
  }

  async readEvidence(chainId: number, txHash: TxHash): Promise<SourceEvidence> {
    this.calls.push({ chainId, txHash });
    return this.evidence;
  }
}

export class RecordingAuthority implements AgentAuthority {
  readonly address = '0xa9e0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0' as const;
  signed: Array<{ authorization: FillAuthorization; domain: { chainId: number; verifyingContract: string } }> = [];

  async signFillAuthorization(
    authorization: FillAuthorization,
    domain: { chainId: number; verifyingContract: `0x${string}` },
  ): Promise<SignedFillAuthorization> {
    this.signed.push({ authorization, domain });
    return {
      authorization,
      signature: `0x${'11'.repeat(65)}`,
      signer: this.address,
    };
  }
}

export class FakeSubmitter implements FillSubmitter {
  submissions: Array<{ chainId: number; vault: string; signed: SignedFillAuthorization }> = [];
  failWith: Error | null = null;

  async submitFastFill(
    chainId: number,
    vault: `0x${string}`,
    signed: SignedFillAuthorization,
  ): Promise<TxHash> {
    if (this.failWith) throw this.failWith;
    this.submissions.push({ chainId, vault, signed });
    return `0x${'ab'.repeat(32)}`;
  }
}
