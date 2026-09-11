import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ARC_TESTNET } from "@/lib/arcaidia/types";
import { useIntentOutcome } from "./use-intent-outcome";

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

const INTENT_ID = `0x${"aa".repeat(32)}`;
const VAULT = "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1".toLowerCase();

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("useIntentOutcome", () => {
  it("reports not-filled while neither a fill nor a settlement exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const { result } = renderHook(() => useIntentOutcome(ARC_TESTNET, INTENT_ID), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data).toEqual({
      filled: false,
      winningVault: null,
      settled: false,
      settlementOutcome: null,
    });
  });

  it("reports the winning vault once a fill lands, unsettled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql.includes("FROM fills")) return nestResponse([{ vault: VAULT }]);
        return nestResponse([]);
      }),
    );

    const { result } = renderHook(() => useIntentOutcome(ARC_TESTNET, INTENT_ID), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data).toMatchObject({ filled: true, winningVault: VAULT, settled: false });
  });

  it("reports settled with the real outcome once a settlement row also exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql.includes("FROM fills")) return nestResponse([{ vault: VAULT }]);
        if (sql.includes("FROM settlements")) return nestResponse([{ outcome: "LP_REIMBURSED" }]);
        throw new Error(`unexpected query: ${sql}`);
      }),
    );

    const { result } = renderHook(() => useIntentOutcome(ARC_TESTNET, INTENT_ID), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data).toEqual({
      filled: true,
      winningVault: VAULT,
      settled: true,
      settlementOutcome: "LP_REIMBURSED",
    });
  });

  it("reports unavailable, and never queries the Nest, with no active intent", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useIntentOutcome(ARC_TESTNET, null), { wrapper });

    expect(result.current).toEqual({ status: "unavailable", reason: "No active intent" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
