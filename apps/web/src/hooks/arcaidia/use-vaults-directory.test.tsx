import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ARC_TESTNET } from "@/lib/arcaidia/types";

const HOUSE_VAULT = "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1";
const INDEPENDENT_VAULT = "0x1111111111111111111111111111111111111111";

/**
 * WP-19.3 feedback: /console should show every vault that has ever
 * participated in the market, not just the connected wallet's own — the
 * same "derive participants from fill history" approach WP-21.1 proposes.
 * Mocks viem (contract reads) and fetch (Nest queries) the same way
 * use-solver-metrics.test.tsx does, since useVaults now does both.
 */
const readContractMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/arcaidia/viem-clients", () => ({
  publicClientFor: () => ({ readContract: readContractMock }),
}));
vi.mock("@/lib/arcaidia/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/arcaidia/config")>();
  return {
    ...actual,
    chainConfig: (chainId: number) => ({ ...actual.chainConfig(chainId), rpcUrl: "https://rpc.example" }),
  };
});

const { useVaults } = await import("./use-vaults");

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

function stubReadContract(byAddress: Record<string, Partial<Record<string, unknown>>>) {
  readContractMock.mockImplementation(async ({ address, functionName }: { address: string; functionName: string }) => {
    const defaults: Record<string, unknown> = {
      owner: "0x2222222222222222222222222222222222222222",
      availableLiquidity: 0n,
      outstandingExposure: 0n,
      paused: false,
      // v2 (WP-26): the vault's live tier and immutable policy, as viem returns them.
      currentFeeBps: 10,
      feePolicy: [10, 25, 60, 120, 5_000, 7_500, 9_000],
    };
    const overrides = byAddress[address.toLowerCase()] ?? {};
    return functionName in overrides ? overrides[functionName] : defaults[functionName];
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  readContractMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("useVaults — ecosystem-wide directory", () => {
  it("includes the House Vault even when it has never won a single fill", async () => {
    stubReadContract({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql === "SELECT id, label FROM vaults") return nestResponse([]);
        return nestResponse([{ fill_count: 0 }]);
      }),
    );

    const { result } = renderHook(() => useVaults(ARC_TESTNET), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]).toMatchObject({ vaultAddress: HOUSE_VAULT, operatorType: "HOUSE" });
  });

  it("discovers an independent vault from fill history, alongside the House Vault, deduped", async () => {
    stubReadContract({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql === "SELECT id, label FROM vaults") {
          // The House Vault is a factory vault too — must not produce a duplicate row.
          return nestResponse([
            { id: HOUSE_VAULT.toLowerCase(), label: "Arcaidia House Vault" },
            { id: INDEPENDENT_VAULT.toLowerCase(), label: "Midnight Runner" },
          ]);
        }
        return nestResponse([{ fill_count: 1 }]);
      }),
    );

    const { result } = renderHook(() => useVaults(ARC_TESTNET), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");

    expect(result.current.data).toHaveLength(2);
    const byType = Object.fromEntries(result.current.data.map((row) => [row.operatorType, row]));
    expect(byType["HOUSE"]?.vaultAddress.toLowerCase()).toBe(HOUSE_VAULT.toLowerCase());
    expect(byType["INDEPENDENT"]?.vaultAddress.toLowerCase()).toBe(INDEPENDENT_VAULT.toLowerCase());
  });

  it("labels a factory vault INDEPENDENT with the label its creator chose, and carries its on-chain price", async () => {
    stubReadContract({ [INDEPENDENT_VAULT.toLowerCase()]: { currentFeeBps: 60 } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql === "SELECT id, label FROM vaults") return nestResponse([{ id: INDEPENDENT_VAULT.toLowerCase(), label: "Midnight Runner" }]);
        return nestResponse([{ fill_count: 1 }]);
      }),
    );

    const { result } = renderHook(() => useVaults(ARC_TESTNET), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");

    const independent = result.current.data.find((row) => row.operatorType === "INDEPENDENT");
    expect(independent?.operatorLabel).toBe("Midnight Runner");
    expect(independent?.currentFeeBps).toBe(60);
    expect(independent?.pricingModelId).toBe("tiered-v1");
    expect(independent?.feePolicy).toEqual({
      baseFeeBps: 10, midFeeBps: 25, highFeeBps: 60, criticalFeeBps: 120,
      midThresholdBps: 5_000, highThresholdBps: 7_500, criticalThresholdBps: 9_000,
    });
  });

  it("falls back to fill-history discovery when the Nest has no vaults view yet (pre re-seed)", async () => {
    stubReadContract({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql === "SELECT id, label FROM vaults") return new Response("no such view", { status: 500 });
        if (sql === "SELECT DISTINCT vault FROM fills") return nestResponse([{ vault: INDEPENDENT_VAULT.toLowerCase() }]);
        return nestResponse([{ fill_count: 1 }]);
      }),
    );

    const { result } = renderHook(() => useVaults(ARC_TESTNET), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");

    expect(result.current.data.map((r) => r.operatorType).sort()).toEqual(["HOUSE", "INDEPENDENT"]);
    expect(result.current.data.find((r) => r.operatorType === "INDEPENDENT")?.operatorLabel).toBeNull();
  });
});
