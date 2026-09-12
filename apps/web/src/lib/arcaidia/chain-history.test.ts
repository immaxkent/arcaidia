import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeEventTopics, getAbiItem, encodeAbiParameters, type AbiEvent } from "viem";
import { ABIS } from "@arcaidia/domain";
import { ETHEREUM_SEPOLIA } from "./types";

// A fake RPC: logs are stored raw (topics + data) so the real viem decode path runs.
type RawLog = { address: string; topics: `0x${string}`[]; data: `0x${string}`; blockNumber: bigint; transactionHash: `0x${string}`; logIndex: number };
const store: { logs: RawLog[]; head: bigint; refuseWiderThan: bigint | null; getLogsCalls: number; vaults: string[] } = {
  logs: [],
  head: 0n,
  refuseWiderThan: null,
  getLogsCalls: 0,
  vaults: [],
};

vi.mock("./viem-clients", async () => {
  const { decodeEventLog } = await import("viem");
  return {
    publicClientFor: () => ({
      getBlockNumber: async () => store.head,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_700_000_000n + blockNumber }),
      readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
        if (functionName === "vaultCount") return BigInt(store.vaults.length);
        if (functionName === "vaults") return store.vaults[Number((args as bigint[])[0])];
        throw new Error(`unexpected read ${functionName}`);
      },
      getLogs: async (p: { address: string | string[]; event: AbiEvent; args?: Record<string, unknown>; fromBlock: bigint; toBlock: bigint }) => {
        store.getLogsCalls += 1;
        if (store.refuseWiderThan !== null && p.toBlock - p.fromBlock > store.refuseWiderThan) throw new Error("query returned more than 10000 results");
        const addresses = (Array.isArray(p.address) ? p.address : [p.address]).map((a) => a.toLowerCase());
        const topic0 = encodeEventTopics({ abi: [p.event], eventName: p.event.name } as never)[0];
        return store.logs
          .filter((l) => addresses.includes(l.address.toLowerCase()) && l.topics[0] === topic0 && l.blockNumber >= p.fromBlock && l.blockNumber <= p.toBlock)
          .map((l) => {
            const decoded = decodeEventLog({ abi: [p.event], data: l.data, topics: l.topics as [`0x${string}`, ...`0x${string}`[]] });
            return { ...l, args: decoded.args };
          })
          .filter((l) => {
            if (!p.args) return true;
            return Object.entries(p.args).every(([k, v]) => {
              const actual = String((l.args as Record<string, unknown>)[k]).toLowerCase();
              return (Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase()).includes(actual);
            });
          });
      },
    }),
  };
});

vi.mock("./config", async (importOriginal) => {
  const original = await importOriginal<typeof import("./config")>();
  return {
    ...original,
    chainConfig: (chainId: number) => ({
      ...original.chainConfig(chainId)!,
      rpcUrl: "http://fake",
      vaultFactory: FACTORY,
      intentRouter: ROUTER,
      settlementReceiver: RECEIVER,
      startBlock: 100,
    }),
  };
});

const FACTORY = "0xD458d83C874296EC4a29c47655Ae47302879b23a";
const ROUTER = "0x69946FFBBE5f250C7357b89E4072F9eAfc1c3ee6";
const RECEIVER = "0x8B93b54d6Df61E9422D14C309F3c9Ab950b920Cd";
const VAULT_B = "0x8c924cA38856f4Fdb2e8f672Fd0084689B1EE47B";
const VAULT_C = "0x3d11E0452a154CF6255F5E12Fb56E361832Da203";
const OWNER = "0xE6f350335A581227f74f3413ae594fc2e76CEe4B";
const SIGNER_B = "0x90f9Cc769bDffAac58510839F7E1E9516a783F90";
const SIGNER_C = "0xC3Ab12211FAD794674b8e56b1ea3c58Af26354CB";
const INTENT_1 = `0x${"11".repeat(32)}` as const;
const INTENT_2 = `0x${"22".repeat(32)}` as const;

function emit(address: string, abi: readonly unknown[], eventName: string, args: Record<string, unknown>, blockNumber: bigint, logIndex = 0) {
  const event = getAbiItem({ abi: abi as never, name: eventName as never }) as AbiEvent;
  const topics = encodeEventTopics({ abi: [event], eventName, args } as never) as `0x${string}`[];
  const nonIndexed = event.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name!])) as `0x${string}`;
  store.logs.push({ address, topics, data, blockNumber, transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}`, logIndex });
}

const POLICY = { baseFeeBps: 5, midFeeBps: 15, highFeeBps: 40, criticalFeeBps: 100, midThresholdBps: 6000, highThresholdBps: 8000, criticalThresholdBps: 9500 };

beforeEach(async () => {
  store.logs = [];
  store.head = 1_000n;
  store.refuseWiderThan = null;
  store.getLogsCalls = 0;
  store.vaults = [VAULT_B, VAULT_C];
  const { resetBlockTimestampCache } = await import("./chain-logs");
  resetBlockTimestampCache();
});
afterEach(() => vi.restoreAllMocks());

describe("vaultLabelsFromChain", () => {
  it("reads every creator label from the factory's VaultCreated events", async () => {
    emit(FACTORY, ABIS.ArcaidiaVaultFactory, "VaultCreated", { vault: VAULT_B, owner: OWNER, label: "Moody House Investments", policy: POLICY, reserveFloorBps: 1000, maxFillBps: 5000, maxExposureBps: 9000 }, 200n);
    emit(FACTORY, ABIS.ArcaidiaVaultFactory, "VaultCreated", { vault: VAULT_C, owner: OWNER, label: "Skylight Deep Hedge", policy: POLICY, reserveFloorBps: 1000, maxFillBps: 5000, maxExposureBps: 9000 }, 300n);
    const { vaultLabelsFromChain } = await import("./chain-history");
    const labels = await vaultLabelsFromChain(ETHEREUM_SEPOLIA);
    expect(labels.get(VAULT_B.toLowerCase())).toMatchObject({ label: "Moody House Investments", owner: OWNER, createdAtBlock: 200n });
    expect(labels.get(VAULT_C.toLowerCase())?.label).toBe("Skylight Deep Hedge");
  });
});

describe("readLogsSince (range splitting)", () => {
  it("splits a refused range in half until the provider accepts it, and still returns every log in order", async () => {
    store.head = 10_000n;
    store.refuseWiderThan = 3_000n;
    emit(FACTORY, ABIS.ArcaidiaVaultFactory, "VaultCreated", { vault: VAULT_B, owner: OWNER, label: "first", policy: POLICY, reserveFloorBps: 0, maxFillBps: 0, maxExposureBps: 0 }, 150n);
    emit(FACTORY, ABIS.ArcaidiaVaultFactory, "VaultCreated", { vault: VAULT_C, owner: OWNER, label: "second", policy: POLICY, reserveFloorBps: 0, maxFillBps: 0, maxExposureBps: 0 }, 9_950n);
    const { vaultLabelsFromChain } = await import("./chain-history");
    const labels = await vaultLabelsFromChain(ETHEREUM_SEPOLIA);
    expect([...labels.values()].map((l) => l.label)).toEqual(["first", "second"]);
    expect(store.getLogsCalls).toBeGreaterThan(1);
  });
});

describe("authorisedSignersFromChain", () => {
  it("replays grants and revocations, most recently granted first", async () => {
    emit(VAULT_B, ABIS.ArcaidiaLiquidityVault, "AuthorisedSignerSet", { signer: SIGNER_B, allowed: true }, 210n);
    emit(VAULT_B, ABIS.ArcaidiaLiquidityVault, "AuthorisedSignerSet", { signer: SIGNER_C, allowed: true }, 220n);
    emit(VAULT_B, ABIS.ArcaidiaLiquidityVault, "AuthorisedSignerSet", { signer: SIGNER_B, allowed: false }, 230n);
    emit(VAULT_B, ABIS.ArcaidiaLiquidityVault, "AuthorisedSignerSet", { signer: SIGNER_B, allowed: true }, 240n);
    const { authorisedSignersFromChain } = await import("./chain-history");
    expect(await authorisedSignersFromChain(ETHEREUM_SEPOLIA, VAULT_B)).toEqual([SIGNER_B, SIGNER_C]);
  });

  it("is empty for a vault that revoked its only signer", async () => {
    emit(VAULT_C, ABIS.ArcaidiaLiquidityVault, "AuthorisedSignerSet", { signer: SIGNER_C, allowed: true }, 210n);
    emit(VAULT_C, ABIS.ArcaidiaLiquidityVault, "AuthorisedSignerSet", { signer: SIGNER_C, allowed: false }, 211n);
    const { authorisedSignersFromChain } = await import("./chain-history");
    expect(await authorisedSignersFromChain(ETHEREUM_SEPOLIA, VAULT_C)).toEqual([]);
  });
});

function intentArgs(intentId: `0x${string}`, sender: string, overrides: Record<string, unknown> = {}) {
  return {
    intentId,
    sender,
    recipient: OWNER,
    intentVersion: 1,
    inputToken: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    amount: 25_000_000n,
    sourceChainId: 11155111n,
    destinationChainId: 5042002n,
    maxFeeBps: 30,
    deadline: 1_800_000_000n,
    nonce: 7n,
    tokenOut: "0x0000000000000000000000000000000000000000",
    targetMinOut: 0n,
    settlementRef: `0x${"00".repeat(32)}`,
    ...overrides,
  };
}

describe("intentsFromChain", () => {
  it("decodes the v1.1 intent, newest first, filtered by sender in the RPC, with the block's timestamp", async () => {
    emit(ROUTER, ABIS.ArcaidiaIntentRouter, "IntentCreated", intentArgs(INTENT_1, OWNER), 400n);
    emit(ROUTER, ABIS.ArcaidiaIntentRouter, "IntentCreated", intentArgs(INTENT_2, SIGNER_B), 500n);
    const { intentsFromChain } = await import("./chain-history");
    const mine = await intentsFromChain(ETHEREUM_SEPOLIA, { sender: OWNER });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      intentId: INTENT_1,
      sender: OWNER,
      amount: 25_000_000n,
      sourceChainId: 11155111,
      destinationChainId: 5042002,
      maxFeeBps: 30,
      intentVersion: 1,
      createdAt: 1_700_000_400,
      blockNumber: 400n,
    });
    const all = await intentsFromChain(ETHEREUM_SEPOLIA);
    expect(all.map((i) => i.intentId)).toEqual([INTENT_2, INTENT_1]);
  });
});

describe("fillsFromChain / settlementsFromChain", () => {
  it("reads every factory vault's FastFilled in one call, tagging the winning vault, and joins the receiver's outcome", async () => {
    emit(VAULT_B, ABIS.ArcaidiaLiquidityVault, "FastFilled", { intentId: INTENT_1, recipient: OWNER, signer: SIGNER_B, inputAmount: 25_000_000n, outputAmount: 24_962_500n, feeAmount: 37_500n, feeBps: 15 }, 410n);
    emit(VAULT_C, ABIS.ArcaidiaLiquidityVault, "FastFilled", { intentId: INTENT_2, recipient: OWNER, signer: SIGNER_C, inputAmount: 10_000_000n, outputAmount: 9_995_000n, feeAmount: 5_000n, feeBps: 5 }, 510n);
    emit(RECEIVER, ABIS.SettlementReceiver, "LpReimbursed", { intentId: INTENT_1, vault: VAULT_B, amount: 25_000_000n }, 600n);
    emit(RECEIVER, ABIS.SettlementReceiver, "HeldForVault", { intentId: INTENT_2, vault: VAULT_C, amount: 10_000_000n }, 610n);
    const { fillsFromChain, settlementsFromChain } = await import("./chain-history");

    const all = await fillsFromChain(ETHEREUM_SEPOLIA);
    expect(all.map((f) => [f.intentId, f.vault.toLowerCase(), f.feeBps])).toEqual([
      [INTENT_2, VAULT_C.toLowerCase(), 5],
      [INTENT_1, VAULT_B.toLowerCase(), 15],
    ]);
    expect(store.getLogsCalls).toBe(1);

    const onlyB = await fillsFromChain(ETHEREUM_SEPOLIA, { vaults: [VAULT_B] });
    expect(onlyB).toHaveLength(1);
    expect(onlyB[0]).toMatchObject({ intentId: INTENT_1, outputAmount: 24_962_500n, feeAmount: 37_500n, timestamp: 1_700_000_410 });

    const settlements = await settlementsFromChain(ETHEREUM_SEPOLIA, [INTENT_1, INTENT_2]);
    expect(settlements.map((s) => [s.intentId, s.outcome])).toEqual(
      expect.arrayContaining([
        [INTENT_1, "LP_REIMBURSED"],
        [INTENT_2, "HELD_FOR_VAULT"],
      ]),
    );
  });

  it("asks for nothing when given no intent ids", async () => {
    const { fillsFromChain, settlementsFromChain } = await import("./chain-history");
    expect(await fillsFromChain(ETHEREUM_SEPOLIA, { intentIds: [] })).toEqual([]);
    expect(await settlementsFromChain(ETHEREUM_SEPOLIA, [])).toEqual([]);
    expect(store.getLogsCalls).toBe(0);
  });
});
