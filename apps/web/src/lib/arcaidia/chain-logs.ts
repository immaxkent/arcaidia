/**
 * Event-log reads straight from the chain — the indexer-free source for everything the
 * protocol's own contracts emit.
 *
 * Every read walks from the chain's v2 `startBlock` (config) to the head. Public RPCs differ
 * in how wide a single `eth_getLogs` range may be, so a refused range is split in half and
 * retried, down to a floor below which the error is real and surfaces. Block timestamps are
 * cached per chain for the page's lifetime: a block's timestamp never changes, and the same
 * blocks come up again on every poll.
 */
import type { AbiEvent, Address, PublicClient } from "viem";

export type ChainLog<TArgs> = {
  readonly args: TArgs;
  readonly address: Address;
  readonly blockNumber: bigint;
  readonly transactionHash: `0x${string}`;
  readonly logIndex: number;
};

export interface LogFilter {
  readonly address: Address | readonly Address[];
  readonly event: AbiEvent;
  /** Indexed-parameter filter, viem's own shape (`{ intentId: [id1, id2] }`). */
  readonly args?: Record<string, unknown>;
}

/** Below this width a refused range is a real error, not a provider's range cap. */
const MIN_SPLIT_WIDTH = 2_000n;

async function readRange<TArgs>(
  client: PublicClient,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ChainLog<TArgs>[]> {
  try {
    const logs = await client.getLogs({
      address: filter.address as Address | Address[],
      event: filter.event,
      ...(filter.args ? { args: filter.args } : {}),
      fromBlock,
      toBlock,
    } as Parameters<PublicClient["getLogs"]>[0]);
    return logs as unknown as ChainLog<TArgs>[];
  } catch (error) {
    if (toBlock - fromBlock < MIN_SPLIT_WIDTH) throw error;
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const [head, tail] = await Promise.all([
      readRange<TArgs>(client, filter, fromBlock, mid),
      readRange<TArgs>(client, filter, mid + 1n, toBlock),
    ]);
    return [...head, ...tail];
  }
}

/** Every matching log from `fromBlock` to the chain head, in chain order. */
export async function readLogsSince<TArgs>(
  client: PublicClient,
  filter: LogFilter,
  fromBlock: number,
): Promise<ChainLog<TArgs>[]> {
  const head = await client.getBlockNumber();
  const from = BigInt(fromBlock);
  if (head < from) return [];
  const logs = await readRange<TArgs>(client, filter, from, head);
  return logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}

const timestampCache = new Map<number, Map<bigint, number>>();
const TIMESTAMP_CONCURRENCY = 6;

/** Unix timestamps for a set of blocks, fetched once per chain and remembered. */
export async function blockTimestamps(
  client: PublicClient,
  chainId: number,
  blockNumbers: Iterable<bigint>,
): Promise<Map<bigint, number>> {
  let cache = timestampCache.get(chainId);
  if (!cache) {
    cache = new Map();
    timestampCache.set(chainId, cache);
  }
  const missing = [...new Set(blockNumbers)].filter((n) => !cache!.has(n));
  for (let i = 0; i < missing.length; i += TIMESTAMP_CONCURRENCY) {
    const batch = missing.slice(i, i + TIMESTAMP_CONCURRENCY);
    const blocks = await Promise.all(batch.map((blockNumber) => client.getBlock({ blockNumber })));
    blocks.forEach((block, j) => cache!.set(batch[j]!, Number(block.timestamp)));
  }
  return cache;
}

/** Test seam — the cache is process-wide, so a test that fakes `getBlock` starts clean. */
export function resetBlockTimestampCache(): void {
  timestampCache.clear();
}
