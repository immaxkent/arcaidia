/**
 * Reads Substreams' own `substreams run ... -o json` CLI output verbatim —
 * the exact file WP-ERC4626-SUBSTREAMS.md's live verification committed
 * (`substreams/erc4626-vault-flows/verification/sepolia-block-11675763.json`),
 * not a hand-written fixture. The CLI wraps the actual JSON payload in
 * human-readable trace/usage-report text on either side; this extracts just
 * the `{ ... }` block between them.
 *
 * This is today's `VaultFlowSource` — a real committed real-world capture,
 * not a live subscription. WP-21.3's "subscribes to map_vault_flows"
 * describes a live gRPC consumer that isn't built yet (no JS Substreams
 * client exists anywhere in this codebase); this source satisfies WP-21's
 * own acceptance gate, which is explicitly "proven against the real
 * committed fixture, not a mock" — replacing this with a live subscriber,
 * behind the exact same `VaultFlowSource` interface, is real, separate,
 * deferred work, not hidden as if it were already done.
 */
import { readFile } from 'node:fs/promises';
import type { VaultFlowEvent, VaultFlowSource } from './types.js';

interface RawBigInt {
  readonly bytes?: string;
}

interface RawDeposit {
  readonly vault: string;
  readonly sender: string;
  readonly owner: string;
  readonly assets?: RawBigInt;
  readonly shares?: RawBigInt;
  readonly txHash: string;
  readonly blockNumber: string | number;
  readonly blockTimestamp: string | number;
  readonly logIndex: number;
}

interface RawWithdraw {
  readonly vault: string;
  readonly sender: string;
  readonly receiver: string;
  readonly owner: string;
  readonly assets?: RawBigInt;
  readonly shares?: RawBigInt;
  readonly txHash: string;
  readonly blockNumber: string | number;
  readonly blockTimestamp: string | number;
  readonly logIndex: number;
}

interface RawVaultFlowsCapture {
  readonly '@data'?: {
    readonly deposits?: RawDeposit[];
    readonly withdraws?: RawWithdraw[];
  };
}

/** A `{bytes: "0x..."}` BigInt is already big-endian hex — BigInt() parses it directly. */
function parseBigInt(value: RawBigInt | undefined): bigint {
  if (!value?.bytes) return 0n;
  return BigInt(value.bytes);
}

export class FixtureParseError extends Error {}

/** Isolates the `{ ... }` JSON payload from the CLI's own surrounding trace/report text. */
export function extractJsonPayload(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new FixtureParseError('No JSON object found in the Substreams CLI output.');
  }
  return raw.slice(start, end + 1);
}

export function parseVaultFlowsCapture(raw: string): VaultFlowEvent[] {
  const payload = JSON.parse(extractJsonPayload(raw)) as RawVaultFlowsCapture;
  const data = payload['@data'] ?? {};

  const deposits: VaultFlowEvent[] = (data.deposits ?? []).map((d): VaultFlowEvent => ({
    kind: 'DEPOSIT',
    vault: d.vault.toLowerCase() as `0x${string}`,
    sender: d.sender as `0x${string}`,
    owner: d.owner as `0x${string}`,
    assets: parseBigInt(d.assets),
    shares: parseBigInt(d.shares),
    txHash: d.txHash as `0x${string}`,
    blockNumber: Number(d.blockNumber),
    blockTimestamp: Number(d.blockTimestamp),
    logIndex: d.logIndex,
  }));

  const withdraws: VaultFlowEvent[] = (data.withdraws ?? []).map((w): VaultFlowEvent => ({
    kind: 'WITHDRAW',
    vault: w.vault.toLowerCase() as `0x${string}`,
    sender: w.sender as `0x${string}`,
    receiver: w.receiver as `0x${string}`,
    owner: w.owner as `0x${string}`,
    assets: parseBigInt(w.assets),
    shares: parseBigInt(w.shares),
    txHash: w.txHash as `0x${string}`,
    blockNumber: Number(w.blockNumber),
    blockTimestamp: Number(w.blockTimestamp),
    logIndex: w.logIndex,
  }));

  return [...deposits, ...withdraws];
}

export class FixtureVaultFlowSource implements VaultFlowSource {
  constructor(private readonly fixturePath: string) {}

  async readVaultFlows(): Promise<readonly VaultFlowEvent[]> {
    const raw = await readFile(this.fixturePath, 'utf8');
    return parseVaultFlowsCapture(raw);
  }
}
