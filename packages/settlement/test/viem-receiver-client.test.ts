import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, toEventSelector } from 'viem';
import { ABIS, type Address, type TxHash } from '@arcaidia/domain';
import { ViemSettlementReceiverClient } from '../src/index.js';
import { ARC, USDC } from './fixtures.js';

const RECEIVER = '0x6666666666666666666666666666666666666666' as const;
const OTHER = '0x9999999999999999999999999999999999999999' as const;
const INTENT = `0x${'ab'.repeat(32)}` as const;
const RECIPIENT = '0x2222222222222222222222222222222222222222' as const;

type Log = { address: Address; topics: readonly `0x${string}`[]; data: `0x${string}` };

/** Builds the events exactly as the contract emits them. */
function lpReimbursedLog(emitter: Address = RECEIVER): Log {
  return {
    address: emitter,
    topics: encodeEventTopics({
      abi: ABIS.SettlementReceiver as readonly unknown[],
      eventName: 'LpReimbursed',
      args: { intentId: INTENT },
    }) as readonly `0x${string}`[],
    data: encodeAbiParameters([{ type: 'uint256' }], [USDC(1_000)]),
  };
}

function fallbackLog(emitter: Address = RECEIVER): Log {
  return {
    address: emitter,
    topics: encodeEventTopics({
      abi: ABIS.SettlementReceiver as readonly unknown[],
      eventName: 'RecipientPaidByFallback',
      args: { intentId: INTENT, recipient: RECIPIENT },
    }) as readonly `0x${string}`[],
    data: encodeAbiParameters([{ type: 'uint256' }], [USDC(1_000)]),
  };
}

function clientFor(logs: Log[], settled = false) {
  const reader = {
    readContract: async () => settled,
    waitForTransactionReceipt: async () => ({ status: 'success' as const, logs }),
  };
  const writer = { writeContract: async () => `0x${'cd'.repeat(32)}` as TxHash };

  return new ViemSettlementReceiverClient(
    new Map([[ARC, reader]]),
    new Map([[ARC, writer]]),
  );
}

describe('ViemSettlementReceiverClient', () => {
  it('reads the LP reimbursement outcome', async () => {
    const result = await clientFor([lpReimbursedLog()]).settle(
      ARC, RECEIVER, INTENT, RECIPIENT, USDC(1_000),
    );
    expect(result.outcome).toBe('LP_REIMBURSED');
  });

  /// The bug this replaced: decodeEventLog given an explicit eventName decodes
  /// whatever it is handed, so a try-each loop reported LP_REIMBURSED for every
  /// settlement — every fallback silently misrecorded.
  it('reads the recipient fallback outcome', async () => {
    const result = await clientFor([fallbackLog()]).settle(
      ARC, RECEIVER, INTENT, RECIPIENT, USDC(1_000),
    );
    expect(result.outcome).toBe('RECIPIENT_FALLBACK');
  });

  it('distinguishes the two events by topic', () => {
    expect(toEventSelector('LpReimbursed(bytes32,uint256)')).not.toBe(
      toEventSelector('RecipientPaidByFallback(bytes32,address,uint256)'),
    );
  });

  /// Only our receiver's events count. Another contract emitting the same
  /// signature must not be read as our outcome.
  it('ignores matching events from another contract', async () => {
    await expect(
      clientFor([fallbackLog(OTHER)]).settle(ARC, RECEIVER, INTENT, RECIPIENT, USDC(1_000)),
    ).rejects.toThrow(/neither outcome event/);
  });

  it('refuses when neither event was emitted', async () => {
    const noise: Log = { address: RECEIVER, topics: [`0x${'ee'.repeat(32)}`], data: '0x' };
    await expect(
      clientFor([noise]).settle(ARC, RECEIVER, INTENT, RECIPIENT, USDC(1_000)),
    ).rejects.toThrow(/neither outcome event/);
  });

  it('reports onchain settlement state', async () => {
    expect(await clientFor([], true).isSettled(ARC, RECEIVER, INTENT)).toBe(true);
    expect(await clientFor([], false).isSettled(ARC, RECEIVER, INTENT)).toBe(false);
  });

  it('throws for an unconfigured chain', async () => {
    await expect(clientFor([]).isSettled(999, RECEIVER, INTENT)).rejects.toThrow(
      /No read client configured/,
    );
  });
});
