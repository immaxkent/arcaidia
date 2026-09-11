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
