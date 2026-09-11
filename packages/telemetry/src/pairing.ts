/**
 * The client side of `TELEMETRY PAIRED` (WP-18.1).
 *
 * Deliberately not part of `TelemetryClient`: pairing is a one-time startup
 * handshake, not a hot-path call — it is fine, and correct, for it to be
 * `async` and to throw on failure, the opposite of `reportStage`/`heartbeat`'s
 * "never blocks, never throws" contract. Mixing the two into one interface
 * would either make pairing silently fire-and-forget (wrong — a solver that
 * never actually paired should know) or make every hot-path call awaitable
 * (wrong — see `client.ts`'s own doc comment on why that guarantee is a
 * compile-time `void` return, not a discipline).
 *
 * `signChallenge` is supplied by the caller, not by this package, so this
 * stays decoupled from `@arcaidia/agent`'s `AgentAuthority`/signer types —
 * telemetry has zero dependencies by design (see this package's own
 * package.json) and pairing is not the exception. Any signer capable of
 * producing a personal-sign (EIP-191) signature over an arbitrary string
 * works: `packages/agent`'s `LocalAgentSigner.signMessage` today, and
 * whatever a Circle Agent Wallet's own message-signing endpoint would supply
 * if that integration is ever built — not decided now, not blocking now, see
 * `WP-INTENT-MARKET.md` §7's own open question on Circle Wallets.
 */

export interface PairingRequest {
  readonly relayUrl: string;
  readonly chainId: number;
  readonly vaultAddress: `0x${string}`;
  readonly operatorAddress: `0x${string}`;
  /** Produces an EIP-191 personal-sign signature over the exact string given. */
  readonly signChallenge: (message: string) => Promise<`0x${string}`>;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export class PairingError extends Error {}

interface ChallengeResponse {
  readonly challenge: string;
  readonly expiresAt: number;
}

/**
 * Proves possession of `operatorAddress` to the Relay for `{chainId,
 * vaultAddress}`. Throws on any failure — unlike telemetry's hot-path calls,
 * a caller that fails to pair needs to know, because nothing else in the
 * system will ever tell it: an unpaired sidecar still lets the solver fill
 * correctly (WP-17.4), it just never lights up the console.
 */
export async function pairWithRelay(request: PairingRequest): Promise<void> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const relayUrl = request.relayUrl.replace(/\/+$/, '');

  const challengeResponse = await fetchImpl(`${relayUrl}/v1/telemetry/pair/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chainId: request.chainId,
      vaultAddress: request.vaultAddress,
      operatorAddress: request.operatorAddress,
    }),
  });
  if (!challengeResponse.ok) {
    throw new PairingError(`Relay refused to issue a pairing challenge: ${challengeResponse.status}.`);
  }
  const { challenge } = (await challengeResponse.json()) as ChallengeResponse;

  const signature = await request.signChallenge(challenge);

  const pairResponse = await fetchImpl(`${relayUrl}/v1/telemetry/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chainId: request.chainId,
      vaultAddress: request.vaultAddress,
      operatorAddress: request.operatorAddress,
      challenge,
      signature,
    }),
  });
  if (!pairResponse.ok) {
    throw new PairingError(`Relay rejected the pairing signature: ${pairResponse.status}.`);
  }
}
