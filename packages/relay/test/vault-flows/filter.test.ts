import { describe, expect, it } from 'vitest';
import { filterForVault, filterKnownParticipants } from '../../src/vault-flows/filter.js';
import type { VaultFlowEvent } from '../../src/vault-flows/types.js';

const KNOWN_VAULT = '0xc74e693938dfbf7c11b787ba27cdde4c0215aaf1' as const;
const STRANGER_VAULT = '0x753937137eb92871a6f3517514d4f1ee860e3fdf' as const;

function deposit(vault: `0x${string}`, logIndex: number): VaultFlowEvent {
  return {
    kind: 'DEPOSIT',
    vault,
    sender: '0x538e5e9797fa86ee25e97289439b6a3aba0165b0',
    owner: '0x538e5e9797fa86ee25e97289439b6a3aba0165b0',
    assets: 1_000n,
    shares: 1_000n,
    txHash: '0xaa',
    blockNumber: 1,
    blockTimestamp: 1,
    logIndex,
  };
}

describe('filterKnownParticipants', () => {
  it('keeps only events whose vault is in the participant set', () => {
    const events = [deposit(KNOWN_VAULT, 0), deposit(STRANGER_VAULT, 1)];
    const kept = filterKnownParticipants(events, new Set([KNOWN_VAULT]));
    expect(kept).toEqual([deposit(KNOWN_VAULT, 0)]);
  });

  it('is case-insensitive on both the event address and the participant set', () => {
    const events = [deposit(KNOWN_VAULT.toUpperCase() as `0x${string}`, 0)];
    const kept = filterKnownParticipants(events, new Set([KNOWN_VAULT.toLowerCase()]));
    expect(kept).toHaveLength(1);
  });

  it('returns an empty array when nothing matches', () => {
    const events = [deposit(STRANGER_VAULT, 0)];
    expect(filterKnownParticipants(events, new Set([KNOWN_VAULT]))).toEqual([]);
  });
});

describe('filterForVault', () => {
  it('narrows to only the requested vault', () => {
    const events = [deposit(KNOWN_VAULT, 0), deposit(STRANGER_VAULT, 1)];
    expect(filterForVault(events, KNOWN_VAULT)).toEqual([deposit(KNOWN_VAULT, 0)]);
  });

  it('is case-insensitive on the requested address', () => {
    const events = [deposit(KNOWN_VAULT, 0)];
    expect(filterForVault(events, KNOWN_VAULT.toUpperCase())).toHaveLength(1);
  });

  it('returns an empty array when the vault has no events', () => {
    const events = [deposit(STRANGER_VAULT, 0)];
    expect(filterForVault(events, KNOWN_VAULT)).toEqual([]);
  });
});
