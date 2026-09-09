/**
 * The real canonical settlement transport: Circle's CCTP V2, over Iris and
 * `MessageTransmitterV2`.
 *
 * `MockSettlementAdapter`'s docstring calls itself a rehearsal for the awkward
 * parts of CCTP; this is where that rehearsal gets checked against the real
 * thing. It is held to the identical conformance suite
 * (`settlement-adapter-conformance.ts`) that the mock passes, so nothing here
 * may quietly behave differently from what the settlement worker was built
 * against.
 *
 * Two properties drive the design, both taken directly from Circle's own
 * behaviour rather than assumed:
 *
 *  - Iris (the attestation API) is polled by **source transaction hash**, not
 *    by nonce or message hash — `GET /v2/messages/{sourceDomain}?transactionHash=…`.
 *    `SettlementReference.sourceTxHash` is therefore the only correlation key
 *    this adapter needs from the reference; `messageRef`/`messageNonce` are
 *    left to whoever constructs the reference and are not read here.
 *  - `MessageTransmitterV2.usedNonces(nonce)` is a public view the adapter
 *    checks *before* attempting `receiveMessage`. On a real network anyone may
 *    submit the destination transaction first — the settlement receiver's own
 *    docs make the same point about `settle` — and `receiveMessage` reverts
 *    with "Nonce already used" if it has. Checking first turns that case into
 *    the ordinary idempotent-completion path instead of a caught revert.
 */

import { toHex } from 'viem';
import {
  SettlementStatus,
  ACTIVE_SETTLEMENT_STATUSES,
  type Bytes32,
  type SettlementAdapter,
  type SettlementHealth,
  type SettlementReference,
  type SettlementState,
  type TxHash,
  type UnixSeconds,
  type Address,
} from '@arcaidia/domain';

/** The subset of `MessageTransmitterV2` this adapter calls. Not one of Arcaidia's own contracts, so declared here rather than generated. */
const MESSAGE_TRANSMITTER_V2_ABI = [
  {
    type: 'function',
    name: 'usedNonces',
    stateMutability: 'view',
    inputs: [{ name: 'nonce', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'receiveMessage',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const;

export interface CctpReadClient {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
  waitForTransactionReceipt(args: { hash: TxHash }): Promise<{ status: 'success' | 'reverted' }>;
}

export interface CctpWriteClient {
  writeContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<TxHash>;
}

export interface CircleCCTPAdapterOptions {
  /** e.g. `https://iris-api-sandbox.circle.com` (testnet) or `https://iris-api.circle.com` (mainnet). */
  readonly irisBaseUrl: string;
  /** `MessageTransmitterV2` address, keyed by the destination chain id. */
  readonly messageTransmitter: ReadonlyMap<number, Address>;
  readonly readers: ReadonlyMap<number, CctpReadClient>;
  readonly writers: ReadonlyMap<number, CctpWriteClient>;
  readonly fetchFn?: typeof fetch;
  readonly clock?: () => UnixSeconds;
  /** Above this average completion time, `health()` reports DEGRADED rather than HEALTHY. */
  readonly degradedAfterSeconds?: number;
}

interface IrisMessage {
  readonly message: `0x${string}`;
  readonly attestation: `0x${string}` | null;
  readonly status: 'complete' | 'pending_confirmations';
  readonly decodedMessage?: { readonly nonce?: string } | null;
}

interface IrisResponse {
  readonly messages?: readonly IrisMessage[];
}

interface Tracked {
  readonly reference: SettlementReference;
  readonly amount: bigint;
  status: SettlementStatus;
  message?: `0x${string}`;
  attestation?: `0x${string}`;
  nonce?: Bytes32;
  destinationTxHash?: TxHash;
  failureReason?: string;
  updatedAt: UnixSeconds;
  completedAt?: UnixSeconds;
  lastPollFailedAt?: UnixSeconds;
}

export class CircleCCTPAdapter implements SettlementAdapter {
  private readonly tracked = new Map<string, Tracked>();
  private readonly clock: () => UnixSeconds;
  private readonly degradedAfter: number;
  private readonly fetchFn: typeof fetch;

  /** Most recent poll failure across every message, for `health()`. */
  private lastGlobalPollFailure: UnixSeconds | null = null;

  constructor(private readonly options: CircleCCTPAdapterOptions) {
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
    this.degradedAfter = options.degradedAfterSeconds ?? 300;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /** Register a commitment the worker discovered (a `SettlementInitiated` event). Mirrors `MockSettlementAdapter.register`. */
  register(reference: SettlementReference, amount: bigint): void {
    this.tracked.set(key(reference.intentId), {
      reference,
      amount,
      status: SettlementStatus.INITIATED,
      updatedAt: this.clock(),
    });
  }

  async status(reference: SettlementReference): Promise<SettlementState> {
    const entry = this.require(reference.intentId);

    if (
      entry.status === SettlementStatus.INITIATED ||
      entry.status === SettlementStatus.PENDING_ATTESTATION
    ) {
      await this.poll(entry);
    }

    return this.snapshot(entry);
  }

  async complete(reference: SettlementReference): Promise<SettlementState> {
    const entry = this.require(reference.intentId);

    if (entry.status === SettlementStatus.RECEIVED || entry.status === SettlementStatus.RECONCILED) {
      return this.snapshot(entry);
    }

    if (
      entry.status === SettlementStatus.INITIATED ||
      entry.status === SettlementStatus.PENDING_ATTESTATION
    ) {
      await this.poll(entry);
    }

    if (entry.status !== SettlementStatus.ATTESTED) {
      throw new Error(
        `Cannot complete ${reference.intentId}: attestation is ${entry.status}, not ATTESTED.`,
      );
    }

    const chainId = entry.reference.destinationChainId;
    const transmitter = this.require2(this.options.messageTransmitter, chainId, 'MessageTransmitterV2 address');
    const reader = this.require2(this.options.readers, chainId, 'read client');
    const writer = this.require2(this.options.writers, chainId, 'write client');

    const nonce = entry.nonce;
    if (!nonce) throw new Error(`No decoded nonce for ${reference.intentId}; cannot check delivery state.`);

    const used = (await reader.readContract({
      address: transmitter,
      abi: MESSAGE_TRANSMITTER_V2_ABI,
      functionName: 'usedNonces',
      args: [nonce],
    })) as bigint;

    if (used !== 0n) {
      // Somebody else already submitted `receiveMessage`. Funds have arrived;
      // there is nothing left for this adapter to do but record it.
      entry.status = SettlementStatus.RECEIVED;
      entry.destinationTxHash = entry.destinationTxHash ?? syntheticHash(reference.intentId);
      entry.completedAt = this.clock();
      entry.updatedAt = this.clock();
      return this.snapshot(entry);
    }

    if (!entry.message || !entry.attestation) {
      throw new Error(`No cached message/attestation for ${reference.intentId}.`);
    }

    let txHash: TxHash;
    try {
      txHash = await writer.writeContract({
        address: transmitter,
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        functionName: 'receiveMessage',
        args: [entry.message, entry.attestation],
      });
    } catch (error) {
      entry.failureReason = asError(error).message;
      entry.updatedAt = this.clock();
      throw error;
    }

    const receipt = await reader.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      const error = new Error(`receiveMessage transaction ${txHash} reverted.`);
      entry.failureReason = error.message;
      entry.updatedAt = this.clock();
      throw error;
    }

    entry.status = SettlementStatus.RECEIVED;
    entry.destinationTxHash = txHash;
    entry.completedAt = this.clock();
    entry.updatedAt = this.clock();

    return this.snapshot(entry);
  }

  async health(): Promise<SettlementHealth> {
    const now = this.clock();
    const recentFailure = this.lastGlobalPollFailure !== null && now - this.lastGlobalPollFailure < 60;

    const average = this.averageLatency();
    const transport: SettlementHealth['transport'] = recentFailure
      ? 'UNAVAILABLE'
      : average !== null && average > this.degradedAfter
        ? 'DEGRADED'
        : 'HEALTHY';

    return {
      transport,
      oldestUnsettledAgeSeconds: this.oldestUnsettledAge(now),
      pendingValue: this.pendingValue(),
      averageSettlementLatencySeconds: average,
      latencySampleSize: this.completed().length,
      observedAt: now,
    };
  }

  // --- internals ------------------------------------------------------------

  /** Fetch Iris and advance local status. Throws on a genuine transport failure. */
  private async poll(entry: Tracked): Promise<void> {
    const url = `${this.options.irisBaseUrl}/v2/messages/${entry.reference.sourceDomain}?transactionHash=${entry.reference.sourceTxHash}`;

    let response: Response;
    try {
      response = await this.fetchFn(url);
    } catch (error) {
      this.lastGlobalPollFailure = this.clock();
      throw new Error(`Iris unreachable: ${asError(error).message}`);
    }

    if (response.status === 404) {
      // Not yet indexed — the burn has not been observed by Iris yet.
      entry.updatedAt = this.clock();
      return;
    }

    if (!response.ok) {
      this.lastGlobalPollFailure = this.clock();
      throw new Error(`Iris returned ${response.status} for ${entry.reference.sourceTxHash}.`);
    }

    const body = (await response.json()) as IrisResponse;
    const message = body.messages?.[0];
    entry.updatedAt = this.clock();

    if (!message) return; // Indexed nothing yet; stays INITIATED.

    entry.status = SettlementStatus.PENDING_ATTESTATION;

    const attested =
      message.status === 'complete' && message.attestation && message.message && message.message !== '0x';
    if (!attested) return;

    entry.status = SettlementStatus.ATTESTED;
    entry.message = message.message;
    entry.attestation = message.attestation ?? undefined;

    const nonceDecimal = message.decodedMessage?.nonce;
    if (nonceDecimal !== undefined) {
      entry.nonce = toHex(BigInt(nonceDecimal), { size: 32 });
    }
  }

  private require(intentId: Bytes32): Tracked {
    const entry = this.tracked.get(key(intentId));
    if (!entry) throw new Error(`No settlement registered for ${intentId}.`);
    return entry;
  }

  private require2<T>(source: ReadonlyMap<number, T>, chainId: number, kind: string): T {
    const value = source.get(chainId);
    if (!value) throw new Error(`No ${kind} configured for chain ${chainId}.`);
    return value;
  }

  private snapshot(entry: Tracked): SettlementState {
    const base = {
      reference: entry.reference,
      status: entry.status,
      amount: entry.amount,
      updatedAt: entry.updatedAt,
    };
    return entry.destinationTxHash === undefined
      ? base
      : { ...base, destinationTxHash: entry.destinationTxHash };
  }

  private completed(): Tracked[] {
    return [...this.tracked.values()].filter((entry) => entry.completedAt !== undefined);
  }

  private unsettled(): Tracked[] {
    return [...this.tracked.values()].filter((entry) =>
      ACTIVE_SETTLEMENT_STATUSES.includes(entry.status),
    );
  }

  private averageLatency(): number | null {
    const done = this.completed();
    if (done.length === 0) return null;
    const total = done.reduce(
      (sum, entry) => sum + (entry.completedAt! - entry.reference.initiatedAt),
      0,
    );
    return Math.round(total / done.length);
  }

  private oldestUnsettledAge(now: UnixSeconds): number | null {
    const ages = this.unsettled().map((entry) => now - entry.reference.initiatedAt);
    return ages.length === 0 ? null : Math.max(...ages);
  }

  private pendingValue(): bigint {
    return this.unsettled().reduce((sum, entry) => sum + entry.amount, 0n);
  }
}

const key = (intentId: Bytes32): string => intentId.toLowerCase();

const syntheticHash = (intentId: Bytes32): TxHash =>
  `0x${intentId.slice(2, 10).padEnd(64, 'f')}` as TxHash;

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));
