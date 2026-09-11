import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { HttpTelemetryClient, pairWithRelay } from '@arcaidia/telemetry';
import { RelayStore } from '../src/store.js';
import { startRelayServer, type RelayServerHandle } from '../src/server.js';
import { ParticipantRegistry } from '../src/participant-registry.js';
import { VaultFlowsService } from '../src/vault-flows/service.js';
import type { NestQueryClient, NestQueryResult } from '../src/nest-client.js';
import type { VaultFlowEvent, VaultFlowSource } from '../src/vault-flows/types.js';

/**
 * The real acceptance gate (`WP-18-telemetry-relay.md`): a real sidecar
 * pairs, heartbeats and streams to a real SSE client, scoped to its own
 * vault only, and an onchain-confirmed stage claimed over telemetry is
 * rejected outright. Uses the actual `@arcaidia/telemetry` client package —
 * the same code a real reference solver runs — against a real, listening
 * HTTP server, not a fake of either side.
 */

const OPERATOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const operator = privateKeyToAccount(OPERATOR_KEY);

const SEPOLIA_VAULT = '0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1' as const;
const ARC_VAULT = '0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1' as const; // same address, different chain
const SEPOLIA_CHAIN = 11155111;
const ARC_CHAIN = 5042002;

let store: RelayStore;
let handle: RelayServerHandle;
let relayUrl: string;

beforeEach(async () => {
  store = new RelayStore({ clock: () => 1_800_000_000 });
  handle = await startRelayServer(store, { port: 0, host: '127.0.0.1' });
  relayUrl = `http://127.0.0.1:${handle.port}`;
});

afterEach(async () => {
  await handle.close();
});

async function realSidecarPairs(chainId: number, vaultAddress: `0x${string}`): Promise<void> {
  await pairWithRelay({
    relayUrl,
    chainId,
    vaultAddress,
    operatorAddress: operator.address,
    signChallenge: (message) => operator.signMessage({ message }),
  });
}

/** Reads Server-Sent Events off a real streaming response until `count` have arrived. */
async function readEvents(response: Response, count: number, timeoutMs = 2_000): Promise<unknown[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: unknown[] = [];

  const deadline = Date.now() + timeoutMs;
  while (events.length < count) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} SSE events.`);
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) events.push(JSON.parse(line.slice('data: '.length)));
      boundary = buffer.indexOf('\n\n');
    }
  }
  void reader.cancel();
  return events;
}

describe('the Relay end to end, over real HTTP', () => {
  it('a real sidecar pairs, heartbeats, and its stages arrive on a real SSE client for its own vault', async () => {
    await realSidecarPairs(SEPOLIA_CHAIN, SEPOLIA_VAULT);

    const stream = await fetch(`${relayUrl}/v1/telemetry/vault/${SEPOLIA_CHAIN}/${SEPOLIA_VAULT}/stream`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');

    const client = new HttpTelemetryClient({ relayUrl });
    client.heartbeat({ chainId: SEPOLIA_CHAIN, vaultAddress: SEPOLIA_VAULT, operatorAddress: operator.address, at: 1 });
    client.reportStage({
      chainId: SEPOLIA_CHAIN,
      vaultAddress: SEPOLIA_VAULT,
      stage: 'INTENT_DISCOVERED',
      intentId: '0x'.padEnd(66, 'a') as `0x${string}`,
      at: 2,
    });

    // Initial snapshot first, then the heartbeat and the stage event — those
    // two are independent fire-and-forget posts, so don't assume an order
    // between them, only that both actually arrived.
    const events = (await readEvents(stream, 3)) as Array<Record<string, unknown>>;

    expect(events[0]).toMatchObject({ paired: true, online: false });
    const rest = events.slice(1);
    expect(rest.some((e) => e.lastHeartbeatAt === 1)).toBe(true);
    expect(rest.some((e) => e.stage === 'INTENT_DISCOVERED')).toBe(true);
  });

  /// The exact scenario `types.ts`'s `VaultKey` doc comment exists for: the
  /// House Vault's address is identical on both chains today. A subscriber
  /// to one chain's stream must never see the other chain's traffic.
  it('never leaks one chain\'s vault traffic into the other chain\'s stream, even at the same address', async () => {
    await realSidecarPairs(SEPOLIA_CHAIN, SEPOLIA_VAULT);
    await realSidecarPairs(ARC_CHAIN, ARC_VAULT);

    const sepoliaStream = await fetch(`${relayUrl}/v1/telemetry/vault/${SEPOLIA_CHAIN}/${SEPOLIA_VAULT}/stream`);
    const arcStream = await fetch(`${relayUrl}/v1/telemetry/vault/${ARC_CHAIN}/${ARC_VAULT}/stream`);

    const client = new HttpTelemetryClient({ relayUrl });
    client.heartbeat({ chainId: SEPOLIA_CHAIN, vaultAddress: SEPOLIA_VAULT, operatorAddress: operator.address, at: 111 });

    const sepoliaEvents = (await readEvents(sepoliaStream, 2)) as Array<Record<string, unknown>>;
    expect(sepoliaEvents[1]).toMatchObject({ chainId: SEPOLIA_CHAIN, lastHeartbeatAt: 111 });

    // ARC's stream only ever gets its own initial snapshot — never Sepolia's
    // heartbeat, even though it was sent after ARC's subscription opened and
    // both vaults share the exact same address.
    const arcEvents = (await readEvents(arcStream, 1)) as Array<Record<string, unknown>>;
    expect(arcEvents[0]).toMatchObject({ chainId: ARC_CHAIN, paired: true, online: false, lastHeartbeatAt: null });
    expect(arcEvents.some((e) => e.lastHeartbeatAt === 111)).toBe(false);

    expect(store.stateOf({ chainId: ARC_CHAIN, vaultAddress: ARC_VAULT }).lastHeartbeatAt).toBeNull();
  });

  it('rejects an onchain-confirmed stage claimed over the telemetry channel, outright', async () => {
    await realSidecarPairs(SEPOLIA_CHAIN, SEPOLIA_VAULT);

    const response = await fetch(`${relayUrl}/v1/telemetry/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chainId: SEPOLIA_CHAIN,
        vaultAddress: SEPOLIA_VAULT,
        operatorAddress: operator.address,
        stage: 'FAST_FILL_CONFIRMED',
        intentId: '0x'.padEnd(66, 'a'),
        at: 1,
      }),
    });

    expect(response.status).toBe(400);
    expect(store.stateOf({ chainId: SEPOLIA_CHAIN, vaultAddress: SEPOLIA_VAULT }).stage).toBeNull();
  });

  it('rejects pairing with a signature from the wrong key, over real HTTP', async () => {
    const impostor = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');

    await expect(
      pairWithRelay({
        relayUrl,
        chainId: SEPOLIA_CHAIN,
        vaultAddress: SEPOLIA_VAULT,
        operatorAddress: operator.address, // claims to be `operator`...
        signChallenge: (message) => impostor.signMessage({ message }), // ...but signs as someone else
      }),
    ).rejects.toThrow();

    expect(store.stateOf({ chainId: SEPOLIA_CHAIN, vaultAddress: SEPOLIA_VAULT }).paired).toBe(false);
  });

  it('GET /health reports ok', async () => {
    const response = await fetch(`${relayUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('GET /v1/vault-flows/{vault} reports 501 when no VaultFlowsService is configured (WP-21.4)', async () => {
    const response = await fetch(`${relayUrl}/v1/vault-flows/${SEPOLIA_VAULT}`);
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'Vault flows are not configured on this Relay instance yet.' });
  });
});

/** WP-21.4, real HTTP: `/v1/vault-flows/{vault}` filters real events through a real service, not a mock of the route. */
describe('GET /v1/vault-flows/{vault} (WP-21.4)', () => {
  const KNOWN_VAULT = '0xc74e693938dfbf7c11b787ba27cdde4c0215aaf1' as const;
  const STRANGER_VAULT = '0x753937137eb92871a6f3517514d4f1ee860e3fdf' as const;

  class FakeNestClient implements NestQueryClient {
    async query<T>(): Promise<NestQueryResult<T>> {
      return { rows: [{ vault: KNOWN_VAULT }] as unknown as T[], count: 1, truncated: false, degraded: false };
    }
  }

  function deposit(vault: `0x${string}`): VaultFlowEvent {
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
      logIndex: 0,
    };
  }

  class FakeVaultFlowSource implements VaultFlowSource {
    async readVaultFlows(): Promise<readonly VaultFlowEvent[]> {
      return [deposit(KNOWN_VAULT), deposit(STRANGER_VAULT)];
    }
  }

  let flowsStore: RelayStore;
  let flowsHandle: RelayServerHandle;
  let flowsUrl: string;

  beforeEach(async () => {
    flowsStore = new RelayStore({ clock: () => 1_800_000_000 });
    const vaultFlows = new VaultFlowsService(
      new ParticipantRegistry('https://nest.example/x', new FakeNestClient()),
      new FakeVaultFlowSource(),
    );
    flowsHandle = await startRelayServer(flowsStore, { port: 0, host: '127.0.0.1', vaultFlows });
    flowsUrl = `http://127.0.0.1:${flowsHandle.port}`;
  });

  afterEach(async () => {
    await flowsHandle.close();
  });

  it('returns only the requested, known-participant vault\'s events, serialized over real JSON', async () => {
    const response = await fetch(`${flowsUrl}/v1/vault-flows/${KNOWN_VAULT}`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { vault: string; events: unknown[] };
    expect(body.vault).toBe(KNOWN_VAULT);
    expect(body.events).toHaveLength(1);
    // bigints serialize as strings over JSON — this is real wire behaviour, not an artifact of the fake.
    expect(body.events[0]).toMatchObject({ kind: 'DEPOSIT', vault: KNOWN_VAULT, assets: '1000' });
  });

  it("returns an empty event list for a stranger's vault, even though it has real flow events elsewhere", async () => {
    const response = await fetch(`${flowsUrl}/v1/vault-flows/${STRANGER_VAULT}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ vault: STRANGER_VAULT, events: [] });
  });
});
