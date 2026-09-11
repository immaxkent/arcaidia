import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ARC_TESTNET, ETHEREUM_SEPOLIA } from "@/lib/arcaidia/types";
import { useAllTransfers, useIntentHistory } from "./use-intent-history";

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

const OWNER = `0x${"e6".repeat(20)}` as const;

const INTENT = {
  id: "0x" + "11".repeat(32),
  sender: OWNER.toLowerCase(),
  recipient: OWNER.toLowerCase(),
  input_token: "0x" + "22".repeat(20),
  amount: "1000000",
  source_chain_id: String(ETHEREUM_SEPOLIA),
  destination_chain_id: String(ARC_TESTNET),
  max_fee_bps: 30,
  deadline: "1800005000",
  created_at_timestamp: 1_800_000_000,
  created_tx_hash: "0x" + "33".repeat(32),
};

const FILL = {
  id: "fill-1",
  intent_id: INTENT.id,
  output_amount: "999000",
  timestamp: 1_800_000_050,
  tx_hash: "0x" + "44".repeat(32),
};

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("useIntentHistory", () => {
  it("joins an intent (source chain) with its fill (destination chain) by intentId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql.startsWith("SELECT id, sender")) return nestResponse([INTENT]);
        if (sql.includes("FROM fills")) return nestResponse([FILL]);
        if (sql.includes("FROM settlements")) return nestResponse([]);
        throw new Error(`unexpected query: ${sql}`);
      }),
    );

    const { result } = renderHook(() => useIntentHistory(OWNER, [ETHEREUM_SEPOLIA, ARC_TESTNET]), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");

    const [row] = result.current.data;
    expect(row?.intent.intentId).toBe(INTENT.id);
    expect(row?.settlement.fastStatus).toBe("FAST_FILLED");
    expect(row?.settlement.canonicalStatus).toBe("PENDING");
    expect(row?.feeCharged).toBe(1_000n); // 1_000_000 - 999_000
    expect(row?.destinationTxHash).toBe(FILL.tx_hash);
  });

  it("only queries the sender's own intents — the WHERE clause carries the connected owner, not a wildcard", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(decodeSql(url));
        return nestResponse([]);
      }),
    );

    renderHook(() => useIntentHistory(OWNER, [ETHEREUM_SEPOLIA, ARC_TESTNET]), { wrapper });

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.every((sql) => sql.includes(`sender = '${OWNER.toLowerCase()}'`))).toBe(true);
  });

  it("reports empty, not an error, when this owner has never sent an intent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const { result } = renderHook(() => useIntentHistory(OWNER, [ETHEREUM_SEPOLIA, ARC_TESTNET]), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("empty"));
  });

  it("reports unavailable with no wallet connected, and never queries the Nest", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useIntentHistory(null, [ETHEREUM_SEPOLIA, ARC_TESTNET]), { wrapper });

    expect(result.current).toEqual({ status: "unavailable", reason: "Connect wallet" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useAllTransfers", () => {
  it("queries intents with no sender filter at all", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(decodeSql(url));
        return nestResponse([]);
      }),
    );

    renderHook(() => useAllTransfers([ETHEREUM_SEPOLIA, ARC_TESTNET]), { wrapper });

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.every((sql) => sql.startsWith("SELECT id, sender") && !sql.includes("WHERE sender"))).toBe(true);
  });

  it("returns transfers from every wallet, not just one", async () => {
    const otherOwner = `0x${"22".repeat(20)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        // Only the Sepolia endpoint answers with rows — otherwise querying
        // both configured chains would double-count the same fixture rows.
        if (sql.startsWith("SELECT id, sender") && url.includes("sepolia")) {
          return nestResponse([INTENT, { ...INTENT, id: `0x${"55".repeat(32)}`, sender: otherOwner }]);
        }
        return nestResponse([]);
      }),
    );

    const { result } = renderHook(() => useAllTransfers([ETHEREUM_SEPOLIA, ARC_TESTNET]), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data).toHaveLength(2);
    expect(new Set(result.current.data.map((r) => r.intent.sender))).toEqual(
      new Set([OWNER.toLowerCase(), otherOwner]),
    );
  });

  it("is never gated on a connected wallet — reports ready/empty regardless", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const { result } = renderHook(() => useAllTransfers([ETHEREUM_SEPOLIA, ARC_TESTNET]), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("empty"));
  });
});
