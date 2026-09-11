import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ARC_TESTNET } from "@/lib/arcaidia/types";

const VAULT = "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1" as const;
const OPERATOR = "0x1111111111111111111111111111111111111111" as const;

/**
 * `useSolverMetrics` needs an RPC URL configured (it reads `chainConfig(...).
 * rpcUrl`, unset in this test env) and a viem client to read from — both
 * mocked here so the test exercises the hook's own combining logic
 * (contract reads + Nest aggregates + telemetry-provided runtime status),
 * not viem or `chainConfig` themselves.
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

const { useSolverMetrics } = await import("./use-solver-metrics");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function nestResponse(rows: unknown[]) {
  return new Response(JSON.stringify({ rows, count: rows.length, truncated: false, degraded: false }), {
    status: 200,
  });
}

function stubReadContract(overrides: Partial<Record<string, unknown>> = {}) {
  readContractMock.mockImplementation(async ({ functionName }: { functionName: string }) => {
    const defaults: Record<string, unknown> = {
      availableLiquidity: 100_000_000n,
      outstandingExposure: 0n,
      paused: false,
      isAuthorisedSigner: false,
    };
    return functionName in overrides ? overrides[functionName] : defaults[functionName];
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  readContractMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("useSolverMetrics", () => {
  it("reads liquidity/exposure/paused from the contract and computes utilisation", async () => {
    stubReadContract({ availableLiquidity: 80_000_000n, outstandingExposure: 20_000_000n });
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const { result } = renderHook(
      () => useSolverMetrics(ARC_TESTNET, VAULT, { candidateOperator: null, telemetryOnline: null }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.availableLiquidity).toBe(80_000_000n);
    expect(result.current.data.outstandingExposure).toBe(20_000_000n);
    expect(result.current.data.utilisationBps).toBe(2_000); // 20% of 100M
  });

  /// WP-19.4's own rule: authorisation is a contract fact, checked for a
  /// specific candidate — never inferred from telemetry pairing.
  it("reports AUTHORISED only when isAuthorisedSigner(candidateOperator) itself says so", async () => {
    stubReadContract({ isAuthorisedSigner: true });
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const { result } = renderHook(
      () => useSolverMetrics(ARC_TESTNET, VAULT, { candidateOperator: OPERATOR, telemetryOnline: null }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.authState).toBe("AUTHORISED");
    expect(result.current.data.authorisedSolver).toBe(OPERATOR);
    expect(readContractMock).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "isAuthorisedSigner", args: [OPERATOR] }),
    );
  });

  it("reports UNAUTHORISED, not null, when the contract explicitly says no for a real candidate", async () => {
    stubReadContract({ isAuthorisedSigner: false });
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const { result } = renderHook(
      () => useSolverMetrics(ARC_TESTNET, VAULT, { candidateOperator: OPERATOR, telemetryOnline: null }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.authState).toBe("UNAUTHORISED");
    expect(result.current.data.authorisedSolver).toBeNull();
  });

  it("reports authState null, not UNAUTHORISED, when there is no candidate operator to check at all", async () => {
    stubReadContract();
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const { result } = renderHook(
      () => useSolverMetrics(ARC_TESTNET, VAULT, { candidateOperator: null, telemetryOnline: null }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.authState).toBeNull();
    expect(readContractMock).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: "isAuthorisedSigner" }));
  });

  /// The contract's own `paused` must win even over a live telemetry heartbeat.
  it("reports PAUSED even when telemetry says online", async () => {
    stubReadContract({ paused: true });
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const { result } = renderHook(
      () => useSolverMetrics(ARC_TESTNET, VAULT, { candidateOperator: null, telemetryOnline: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.runtimeStatus).toBe("PAUSED");
  });

  it("falls back to telemetry's own online/offline when the vault is not paused", async () => {
    stubReadContract({ paused: false });
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const { result: online } = renderHook(
      () => useSolverMetrics(ARC_TESTNET, VAULT, { candidateOperator: null, telemetryOnline: true }),
      { wrapper },
    );
    await waitFor(() => expect(online.current.status).toBe("ready"));
    if (online.current.status !== "ready") throw new Error("expected ready");
    expect(online.current.data.runtimeStatus).toBe("ONLINE");

    const { result: offline } = renderHook(
      () => useSolverMetrics(ARC_TESTNET, VAULT, { candidateOperator: null, telemetryOnline: false }),
      { wrapper },
    );
    await waitFor(() => expect(offline.current.status).toBe("ready"));
    if (offline.current.status !== "ready") throw new Error("expected ready");
    expect(offline.current.data.runtimeStatus).toBe("OFFLINE");
  });

  it("reads totalVolume/transactionCount/totalFees from the Nest's own aggregate columns", async () => {
    stubReadContract();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
        if (sql.includes("SUM(output_amount)")) return nestResponse([{ total_volume: "5000000" }]);
        if (sql.includes("FROM vault")) return nestResponse([{ fill_count: 3 }]);
        if (sql.includes("FROM protocol_state")) return nestResponse([{ total_fees_earned: "15000" }]);
        throw new Error(`unexpected query: ${sql}`);
      }),
    );

    const { result } = renderHook(
      () => useSolverMetrics(ARC_TESTNET, VAULT, { candidateOperator: null, telemetryOnline: null }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.totalVolume).toBe(5_000_000n);
    expect(result.current.data.transactionCount).toBe(3);
    expect(result.current.data.totalFees).toBe(15_000n);
  });

  it("reports unavailable with no vault deployed", () => {
    const { result } = renderHook(
      () => useSolverMetrics(ARC_TESTNET, null, { candidateOperator: null, telemetryOnline: null }),
      { wrapper },
    );
    expect(result.current).toEqual({ status: "unavailable", reason: "Deploy vault first" });
  });
});
