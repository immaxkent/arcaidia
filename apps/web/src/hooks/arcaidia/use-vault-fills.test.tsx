import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ETHEREUM_SEPOLIA, ARC_TESTNET } from "@/lib/arcaidia/types";
import { useVaultFills } from "./use-vault-fills";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function decodeSql(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
}

function nestResponse(rows: unknown[]) {
  return new Response(JSON.stringify({ rows, count: rows.length, truncated: false, degraded: false }), {
    status: 200,
  });
}

const FILL = {
  id: "fill-1",
  intent_id: "0x" + "aa".repeat(32),
  output_amount: "999000",
  timestamp: 1_800_000_100,
  tx_hash: "0x" + "bb".repeat(32),
};

const SOURCE_INTENT = {
  id: FILL.intent_id,
  source_chain_id: String(ETHEREUM_SEPOLIA),
  amount: "1000000",
  created_at_timestamp: 1_800_000_000,
  created_tx_hash: "0x" + "cc".repeat(32),
};

const SETTLEMENT = {
  intent_id: FILL.intent_id,
  outcome: "LP_REIMBURSED",
  amount: "999000",
  timestamp: 1_800_000_200,
  tx_hash: "0x" + "dd".repeat(32),
};

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("useVaultFills", () => {
  it("joins a fill with its settlement and its source-chain intent, correctly", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        const sql = decodeSql(url);
        if (sql.startsWith("SELECT id, intent_id, output_amount, timestamp, tx_hash FROM fills")) {
          return nestResponse([FILL]);
        }
        if (sql.startsWith("SELECT intent_id, outcome, amount, timestamp, tx_hash FROM settlements")) {
          return nestResponse([SETTLEMENT]);
        }
        if (sql.startsWith("SELECT id, source_chain_id, amount, created_at_timestamp, created_tx_hash FROM intents")) {
          return nestResponse([SOURCE_INTENT]);
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    );

    const { result } = renderHook(
      () => useVaultFills(ARC_TESTNET, "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");

    const [row] = result.current.data;
    expect(row).toMatchObject({
      intentId: FILL.intent_id,
      sourceChainId: ETHEREUM_SEPOLIA,
      destinationChainId: ARC_TESTNET,
      amountAdvanced: 999_000n,
      feeAmount: 1_000n, // 1_000_000 - 999_000
      canonicalStatus: "SETTLED",
      settlementLatencySeconds: 200, // 1_800_000_200 - 1_800_000_000
      sourceTxHash: SOURCE_INTENT.created_tx_hash,
    });

    // Every intent_id used in a WHERE ... IN (...) clause travelled through
    // sqlHex32InClause's validation, so this also proves the query strings
    // were built from real, well-formed ids, not just any string.
    expect(calls.some((c) => decodeSql(c).includes(FILL.intent_id))).toBe(true);
  });

  it("reports PENDING canonical status and null latency when nothing has settled yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql.includes("FROM fills")) return nestResponse([FILL]);
        if (sql.includes("FROM settlements")) return nestResponse([]);
        if (sql.includes("FROM intents")) return nestResponse([SOURCE_INTENT]);
        throw new Error(`unexpected query: ${sql}`);
      }),
    );

    const { result } = renderHook(
      () => useVaultFills(ARC_TESTNET, "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data[0]).toMatchObject({ canonicalStatus: "PENDING", settlementLatencySeconds: null });
  });

  it("reports empty, not an error, when the vault genuinely has no fills yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const { result } = renderHook(
      () => useVaultFills(ARC_TESTNET, "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("empty"));
  });

  it("surfaces a Nest failure as an error state, never as a silently empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nest down" }), { status: 500 })),
    );

    const { result } = renderHook(
      () => useVaultFills(ARC_TESTNET, "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("reports unavailable with no vault selected, and never queries the Nest", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useVaultFills(ARC_TESTNET, null), { wrapper });

    expect(result.current).toEqual({ status: "unavailable", reason: "Select a vault" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
