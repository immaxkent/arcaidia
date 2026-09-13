import { describe, expect, it } from "vitest";
import { decodeChallenge, formatTinybar, hashscanTransactionUrl } from "./use-x402-gateway";

describe("decodeChallenge", () => {
  it("reads the first accepts entry of a base64 PAYMENT-REQUIRED header", () => {
    const header = btoa(
      JSON.stringify({
        x402Version: 2,
        resource: { url: "https://intel.example/v1/intelligence/ecosystem", description: "Cross-chain liquidity" },
        accepts: [{ scheme: "exact", network: "hedera:testnet", asset: "0.0.0", amount: "1000000", payTo: "0.0.10511371", maxTimeoutSeconds: 120, extra: { feePayer: "0.0.7777" } }],
      }),
    );
    expect(decodeChallenge(402, header)).toMatchObject({ status: 402, scheme: "exact", network: "hedera:testnet", amount: "1000000", payTo: "0.0.10511371", feePayer: "0.0.7777", description: "Cross-chain liquidity" });
  });
  it("is tolerant of a missing or malformed header", () => {
    expect(decodeChallenge(200, null).amount).toBeNull();
    expect(decodeChallenge(402, "%%%").payTo).toBeNull();
  });
});

describe("hashscan + tinybar formatting", () => {
  it("normalises the x402 receipt id to HashScan's form", () => {
    expect(hashscanTransactionUrl("0.0.4444@1700000000.123456789")).toBe("https://hashscan.io/testnet/transaction/0.0.4444-1700000000-123456789");
  });
  it("formats tinybar as HBAR", () => {
    expect(formatTinybar("1000000")).toBe("0.01 ℏ");
    expect(formatTinybar("100000000")).toBe("1 ℏ");
  });
});
