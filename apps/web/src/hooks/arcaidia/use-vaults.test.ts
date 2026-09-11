import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARC_TESTNET } from "@/lib/arcaidia/types";
import { readVaultAggregates } from "./use-vaults";

const VAULT = "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1" as const;

function decodeSql(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
}

function nestResponse(rows: unknown[]) {
  return new Response(JSON.stringify({ rows, count: rows.length, truncated: false, degraded: false }), {
    status: 200,
  });
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("readVaultAggregates (WP-23)", () => {
  it("reads fill_count from vault and total_fees_earned from protocol_state, correctly parsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql.includes("FROM vault")) {
          expect(sql).toContain(VAULT.toLowerCase());
          return nestResponse([{ fill_count: 7 }]);
        }
        if (sql.includes("FROM protocol_state")) return nestResponse([{ total_fees_earned: "123456" }]);
        throw new Error(`unexpected query: ${sql}`);
      }),
    );

    const result = await readVaultAggregates(ARC_TESTNET, VAULT);
    expect(result).toEqual({ successfulFillCount: 7, lifetimeFees: 123_456n });
  });

  it("degrades to null fields, never throws, when the Nest is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));

    const result = await readVaultAggregates(ARC_TESTNET, VAULT);
    expect(result).toEqual({ successfulFillCount: null, lifetimeFees: null });
  });

  it("reports null, not zero, when the vault has never been indexed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nestResponse([])));

    const result = await readVaultAggregates(ARC_TESTNET, VAULT);
    expect(result).toEqual({ successfulFillCount: null, lifetimeFees: null });
  });
});

describe("fetchVaultAnalyticsData (WP-19.3 feedback — utilisation-over-time chart)", () => {
  it("replays deposit -> fill -> reimburse into correct utilisation/volume/fee series", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql.includes("FROM liquidity_vault__deposit")) {
          return nestResponse([{ assets: "100000000", block_timestamp: 1_000 }]);
        }
        if (sql.includes("FROM liquidity_vault__withdraw")) return nestResponse([]);
        if (sql.includes("FROM liquidity_vault__fast_filled")) {
          return nestResponse([{ outputAmount: "4000000", block_timestamp: 2_000 }]);
        }
        if (sql.includes("FROM liquidity_vault__reimbursement_recorded")) {
          return nestResponse([{ amountReceived: "4004000", exposureCleared: "4000000", block_timestamp: 3_000 }]);
        }
        if (sql.includes("FROM vault")) {
          // balance: 100_000_000 - 4_000_000 + 4_004_000 = 100_004_000; exposure: 0
          return nestResponse([{ liquid_balance: "100004000", outstanding_exposure: "0" }]);
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    );

    const { fetchVaultAnalyticsData } = await import("./use-vaults");
    const result = await fetchVaultAnalyticsData(ARC_TESTNET, VAULT);

    expect(result.utilisationSeries).toEqual([
      { at: 1_000, bps: 0 }, // deposit: exposure 0 / total 100_000_000
      { at: 2_000, bps: 400 }, // fill: exposure 4_000_000 / total 100_000_000 = 4.00%
      { at: 3_000, bps: 0 }, // reimbursed back to 0 exposure
    ]);
    expect(result.volumeSeries).toEqual([{ at: 2_000, value: 4_000_000n }]);
    expect(result.feeSeries).toEqual([{ at: 3_000, value: 4_000n }]);
    expect(result.stateSeries).toEqual([
      { at: 1_000, balance: 100_000_000n, exposure: 0n },
      { at: 2_000, balance: 96_000_000n, exposure: 4_000_000n },
      { at: 3_000, balance: 100_004_000n, exposure: 0n },
    ]);
  });

  /// The load-bearing safety check: if replaying every known event does not
  /// land on the vault's real, current on-chain balance/exposure, this must
  /// refuse to return a chart at all rather than show a silently wrong one.
  it("throws rather than returning a chart when the reconstruction disagrees with the vault's real current state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql.includes("FROM liquidity_vault__deposit")) {
          return nestResponse([{ assets: "100000000", block_timestamp: 1_000 }]);
        }
        if (sql.includes("FROM liquidity_vault__withdraw")) return nestResponse([]);
        if (sql.includes("FROM liquidity_vault__fast_filled")) return nestResponse([]);
        if (sql.includes("FROM liquidity_vault__reimbursement_recorded")) return nestResponse([]);
        if (sql.includes("FROM vault")) {
          // Deliberately wrong: real balance disagrees with the only event we replayed.
          return nestResponse([{ liquid_balance: "999", outstanding_exposure: "0" }]);
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    );

    const { fetchVaultAnalyticsData } = await import("./use-vaults");
    await expect(fetchVaultAnalyticsData(ARC_TESTNET, VAULT)).rejects.toThrow(/does not match/);
  });

  it("returns an empty series, not an error, for a vault with no history at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const sql = decodeSql(url);
        if (sql.includes("FROM vault")) {
          return nestResponse([{ liquid_balance: "0", outstanding_exposure: "0" }]);
        }
        return nestResponse([]);
      }),
    );

    const { fetchVaultAnalyticsData } = await import("./use-vaults");
    const result = await fetchVaultAnalyticsData(ARC_TESTNET, VAULT);
    expect(result).toEqual({ volumeSeries: [], feeSeries: [], utilisationSeries: [], feeTierSeries: [], stateSeries: [] });
  });
});
