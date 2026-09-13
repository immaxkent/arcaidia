import { describe, expect, it, vi } from "vitest";
import { describeTxError, waitForCode, waitForReceiptResilient } from "./tx";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("describeTxError — one short, actionable line", () => {
  it("maps a chain mismatch to a switch-network instruction naming the chain", () => {
    const viemLike = {
      shortMessage: "The current chain of the wallet (id: 11155111) does not match the target chain for the transaction (id: 5042002 – Arc Testnet).",
      message: "ChainMismatchError: The current chain of the wallet (id: 11155111) does not match...\n\nCurrent Chain ID:  11155111\nExpected Chain ID: 5042002 – Arc Testnet\n\nVersion: viem@2.56.3",
    };
    const d = describeTxError(viemLike, 5042002);
    expect(d.kind).toBe("wrong-chain");
    expect(d.detail).toContain("Arc Testnet");
    expect(d.detail.length).toBeLessThan(120);
  });

  it("recognises a rate-limited RPC and says the tx may have landed", () => {
    const d = describeTxError(new Error("rate limit exceeded: Request exceeds defined limit."));
    expect(d.kind).toBe("rate-limit");
    expect(d.detail).toMatch(/may still have gone through/);
  });

  it("recognises a declined signature", () => {
    expect(describeTxError({ code: 4001, message: "User rejected the request." }).kind).toBe("rejected");
  });

  it("truncates an unknown error to its first line", () => {
    const d = describeTxError(new Error(`${"x".repeat(400)}\nsecond line`));
    expect(d.kind).toBe("other");
    expect(d.detail.length).toBeLessThanOrEqual(160);
    expect(d.detail).not.toContain("second line");
  });
});

describe("waitForReceiptResilient", () => {
  it("backs off through rate-limit errors and returns the receipt once the RPC answers", async () => {
    let calls = 0;
    const client = {
      async getTransactionReceipt() {
        calls += 1;
        if (calls < 3) throw new Error("429 rate limit exceeded");
        return { status: "success" } as never;
      },
    };
    const sleeps: number[] = [];
    const receipt = await waitForReceiptResilient(client, "0xab", { sleepFn: async (ms) => { sleeps.push(ms); }, initialDelayMs: 100 });
    expect(receipt).toEqual({ status: "success" });
    expect(sleeps).toEqual([100, 200]);
  });

  it("returns null on timeout instead of throwing, so the caller can recover from chain state", async () => {
    const client = { async getTransactionReceipt() { throw new Error("rate limit"); } };
    const receipt = await waitForReceiptResilient(client, "0xab", { timeoutMs: 0, sleepFn: async () => {} });
    expect(receipt).toBeNull();
  });
});

describe("waitForCode", () => {
  it("resolves true when the predicted address gains code, tolerating errors in between", async () => {
    let calls = 0;
    const client = {
      async getCode() {
        calls += 1;
        if (calls === 1) throw new Error("rate limit");
        return calls < 3 ? "0x" : "0x6080";
      },
    };
    expect(await waitForCode(client, "0xab", { sleepFn: async () => {} })).toBe(true);
  });
});
