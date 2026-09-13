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

/**
 * Public providers cap one `eth_getLogs` at about 10 000 blocks (dRPC's free plan says so
 * outright). Ranges are cut to this up front and read a few at a time, instead of discovering
 * the cap by halving a refused 100 000-block range call after call.
 */
const WINDOW = 9_000n;
const WINDOW_CONCURRENCY = 4;
/** Some providers cap far lower than they say (dRPC's free plan: a few hundred blocks). */
const MIN_WINDOW = 100n;
/** The window each chain's provider has been seen to accept — learned by halving on refusal. */
const learnedWindow = new Map<number, bigint>();

async function readWindow<TArgs>(
  client: PublicClient,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ChainLog<TArgs>[]> {
  const logs = await client.getLogs({
    address: filter.address as Address | Address[],
    event: filter.event,
    ...(filter.args ? { args: filter.args } : {}),
    fromBlock,
    toBlock,
  } as Parameters<PublicClient["getLogs"]>[0]);
  return logs as unknown as ChainLog<TArgs>[];
}

/** Every matching log from `fromBlock` to the chain head, in chain order. */
export async function readLogsSince<TArgs>(
  client: PublicClient,
  filter: LogFilter,
  fromBlock: number,
  chainId = client.chain?.id ?? 0,
): Promise<ChainLog<TArgs>[]> {
  const head = await client.getBlockNumber();
  const from = BigInt(fromBlock);
  if (head < from) return [];
  let window = learnedWindow.get(chainId) ?? WINDOW;
  const logs: ChainLog<TArgs>[] = [];
  let start = from;
  while (start <= head) {
    // A batch of windows at the current size; a refusal halves the size and retries the batch.
    const batch: Array<[bigint, bigint]> = [];
    for (let i = 0; i < WINDOW_CONCURRENCY && start <= head; i++) {
      const end = start + window - 1n < head ? start + window - 1n : head;
      batch.push([start, end]);
      start = end + 1n;
    }
    try {
      const results = await Promise.all(batch.map(([a, b]) => readWindow<TArgs>(client, filter, a, b)));
      for (const r of results) logs.push(...r);
    } catch (error) {
      if (window <= MIN_WINDOW) throw error;
      window = window / 2n < MIN_WINDOW ? MIN_WINDOW : window / 2n;
      learnedWindow.set(chainId, window);
      start = batch[0]![0];
    }
  }
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

/** Test seam — the caches are process-wide, so a test that fakes the client starts clean. */
export function resetBlockTimestampCache(): void {
  timestampCache.clear();
  learnedWindow.clear();
}
