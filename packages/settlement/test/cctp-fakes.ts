import type { Address, TxHash } from '@arcaidia/domain';
import type { CctpReadClient, CctpWriteClient } from '../src/adapters/circle-cctp-adapter.js';

/**
 * A fake Iris (Circle's attestation API), keyed the same way the real one is
 * queried: by source domain and transaction hash. Never returns anything until
 * told to — mirroring that a real burn is invisible to Iris until it indexes it.
 *
 * The fake `message` payload it hands back is deliberately just the nonce,
 * hex-encoded to 32 bytes. The adapter under test treats `message` as opaque —
 * it only ever passes it straight through to `receiveMessage` — so `message`
 * doubling as an identifiable nonce marker here is what lets
 * `FakeMessageTransmitter.writeContract` below know which nonce to mark used,
 * without the fake needing to implement CCTP's real message encoding.
 */
export class FakeIris {
  private readonly byKey = new Map<
    string,
    { status: 'pending_confirmations' | 'complete'; nonce?: bigint }
  >();

  reachable = true;

  private key(domain: number, txHash: string): string {
    return `${domain}:${txHash.toLowerCase()}`;
  }

  setPending(domain: number, txHash: string): void {
    this.byKey.set(this.key(domain, txHash), { status: 'pending_confirmations' });
  }

  setAttested(domain: number, txHash: string, nonce: bigint): void {
    this.byKey.set(this.key(domain, txHash), { status: 'complete', nonce });
  }

  /** The `fetch` this adapter is given. */
  fetchFn: typeof fetch = async (input) => {
    if (!this.reachable) throw new Error('network unreachable');

    const url = new URL(String(input));
    const domain = Number(url.pathname.split('/').pop());
    const txHash = url.searchParams.get('transactionHash') ?? '';
    const entry = this.byKey.get(this.key(domain, txHash));

    if (!entry) {
      return new Response(null, { status: 404 });
    }

    const messageHex = entry.nonce !== undefined ? nonceToHex(entry.nonce) : '0x';

    return new Response(
      JSON.stringify({
        messages: [
          {
            message: entry.status === 'complete' ? messageHex : '0x',
            attestation: entry.status === 'complete' ? `0x${'bb'.repeat(65)}` : null,
            status: entry.status,
            decodedMessage: entry.nonce !== undefined ? { nonce: entry.nonce.toString() } : null,
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

/**
 * A fake `MessageTransmitterV2`: tracks used nonces and lets tests fail the
 * write or the receipt independently, the same distinction the real chain
 * draws between "the RPC call failed" (`writeContract` throws) and "the
 * transaction reverted" (a receipt with `status: 'reverted'`).
 */
export class FakeMessageTransmitter implements CctpReadClient, CctpWriteClient {
  private readonly used = new Set<string>();
  receiverHoldings = 0n;

  failNextWrite = 0;
  failNextReceipt = 0;

  private pendingNonce: string | null = null;
  private amountPerDelivery = 0n;

  /** What a successful `receiveMessage` should credit — the test sets this to the reference's amount. */
  setDeliveryAmount(amount: bigint): void {
    this.amountPerDelivery = amount;
  }

  /** Simulates somebody else submitting `receiveMessage` first. */
  markUsedExternally(nonce: bigint, amount: bigint): void {
    this.used.add(nonceToHex(nonce).toLowerCase());
    this.receiverHoldings += amount;
  }

  async readContract(args: { functionName: string; args: readonly unknown[] }): Promise<unknown> {
    if (args.functionName === 'usedNonces') {
      const nonce = (args.args[0] as string).toLowerCase();
      return this.used.has(nonce) ? 1n : 0n;
    }
    throw new Error(`unexpected read ${args.functionName}`);
  }

  async waitForTransactionReceipt(args: { hash: TxHash }): Promise<{ status: 'success' | 'reverted' }> {
    void args;
    if (this.failNextReceipt > 0) {
      this.failNextReceipt -= 1;
      this.pendingNonce = null;
      return { status: 'reverted' };
    }
    if (this.pendingNonce) {
      this.used.add(this.pendingNonce);
      this.receiverHoldings += this.amountPerDelivery;
      this.pendingNonce = null;
    }
    return { status: 'success' };
  }

  async writeContract(args: { functionName: string; args: readonly unknown[] }): Promise<TxHash> {
    if (args.functionName !== 'receiveMessage') throw new Error(`unexpected write ${args.functionName}`);
    if (this.failNextWrite > 0) {
      this.failNextWrite -= 1;
      throw new Error('RPC error submitting receiveMessage');
    }
    // `message` is the nonce-as-hex the fake Iris handed back — see the class doc above.
    this.pendingNonce = String(args.args[0]).toLowerCase();
    return `0x${'cc'.repeat(32)}` as TxHash;
  }
}

const nonceToHex = (nonce: bigint): `0x${string}` =>
  `0x${nonce.toString(16).padStart(64, '0')}` as `0x${string}`;

export const MESSAGE_TRANSMITTER: Address = '0x1111111111111111111111111111111111111a' as Address;
