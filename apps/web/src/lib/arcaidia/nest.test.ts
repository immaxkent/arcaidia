import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nestReady, queryNest, sqlHex20Literal, sqlHex32InClause } from "./nest";
import type { Hex } from "./types";

const ENDPOINT = "https://hackathon.example.invalid/arcaidia-sepolia";

function fakeFetch(impl: (url: string) => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queryNest", () => {
  it("issues a GET to /sql?q=<encoded SELECT>, matching FetchNestQueryClient's wire contract", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      fakeFetch(async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({ rows: [{ a: 1 }], count: 1, truncated: false, degraded: false }), {
          status: 200,
        });
      }),
    );

    const result = await queryNest<{ a: number }>(ENDPOINT, "SELECT a FROM vault");

    expect(calls[0]).toBe(`${ENDPOINT}/sql?q=SELECT%20a%20FROM%20vault`);
    expect(result.rows).toEqual([{ a: 1 }]);
  });

  it("strips a trailing slash from the endpoint", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      fakeFetch(async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }),
    );

    await queryNest(`${ENDPOINT}/`, "SELECT 1");
    expect(calls[0]).toBe(`${ENDPOINT}/sql?q=SELECT%201`);
  });

  it("throws on a non-2xx response, surfacing the Nest's own error message", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(async () => new Response(JSON.stringify({ error: "bad query" }), { status: 400 })),
    );

    await expect(queryNest(ENDPOINT, "SELECT bogus")).rejects.toThrow(/bad query/);
  });

  /// A degraded response is a partial-truth signal, not a real answer — must
  /// never be silently rendered as if the data were complete.
  it("throws when the Nest reports degraded data, rather than returning it as if complete", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(async () => new Response(JSON.stringify({ rows: [{ a: 1 }], degraded: true }), { status: 200 })),
    );

    await expect(queryNest(ENDPOINT, "SELECT a FROM vault")).rejects.toThrow(/degraded/);
  });

  it("throws when the Nest reports the result was truncated, rather than silently returning a partial table", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(async () => new Response(JSON.stringify({ rows: [{ a: 1 }], truncated: true }), { status: 200 })),
    );

    await expect(queryNest(ENDPOINT, "SELECT a FROM vault")).rejects.toThrow(/truncated/);
  });

  it("returns an empty row list, not an error, for a genuinely empty result", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(async () => new Response(JSON.stringify({ rows: [], count: 0 }), { status: 200 })),
    );

    const result = await queryNest(ENDPOINT, "SELECT 1 WHERE false");
    expect(result.rows).toEqual([]);
  });

  /// Confirmed live, 2026-09-11: the Nest enforces a real concurrent-query
  /// cap and answers with 503 under load. A page firing several queries at
  /// once (one vault's history is already 4 queries) must not surface that
  /// as a permanent-looking failure.
  it("retries a 503 (server busy) and succeeds once the Nest answers", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      fakeFetch(async () => {
        calls++;
        if (calls < 3) return new Response(JSON.stringify({ error: "server busy" }), { status: 503 });
        return new Response(JSON.stringify({ rows: [{ a: 1 }] }), { status: 200 });
      }),
    );

    const result = await queryNest<{ a: number }>(ENDPOINT, "SELECT a FROM vault");
    expect(result.rows).toEqual([{ a: 1 }]);
    expect(calls).toBe(3);
  });

  it("retries a 429 the same way as a 503", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      fakeFetch(async () => {
        calls++;
        if (calls < 2) return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }),
    );

    await queryNest(ENDPOINT, "SELECT 1");
    expect(calls).toBe(2);
  });

  it("gives up and throws after exhausting retries on a persistent 503", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(async () => new Response(JSON.stringify({ error: "server busy" }), { status: 503 })),
    );

    await expect(queryNest(ENDPOINT, "SELECT 1")).rejects.toThrow(/503/);
  });

  it("never retries a non-retryable status (e.g. 400) — fails fast instead", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      fakeFetch(async () => {
        calls++;
        return new Response(JSON.stringify({ error: "bad query" }), { status: 400 });
      }),
    );

    await expect(queryNest(ENDPOINT, "SELECT bogus")).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("nestReady", () => {
  it("parses the Nest's /ready response into camelCase", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(async () => new Response(JSON.stringify({ ready: true, last_poll_unixtime: 12345 }), { status: 200 })),
    );

    expect(await nestReady(ENDPOINT)).toEqual({ ready: true, lastPollUnixtime: 12345 });
  });

  it("throws on a non-2xx /ready response", async () => {
    vi.stubGlobal("fetch", fakeFetch(async () => new Response(null, { status: 503 })));
    await expect(nestReady(ENDPOINT)).rejects.toThrow();
  });
});

describe("sqlHex32InClause", () => {
  it("builds a valid, lowercased IN clause from hex32 values", () => {
    const id = `0x${"AA".repeat(32)}` as Hex;
    expect(sqlHex32InClause([id])).toBe(`'${id.toLowerCase()}'`);
  });

  /// The load-bearing guard: this string is spliced directly into a raw SQL
  /// query sent over the wire, so a value that isn't a validated hex32 must
  /// never reach that string.
  it("refuses a value that is not a well-formed hex32 — the SQL-injection guard", () => {
    expect(() => sqlHex32InClause(["'; DROP TABLE fills; --" as Hex])).toThrow(/non-hex32/);
  });

  it("refuses a hex20 (address-length) value passed where a hex32 id is expected", () => {
    expect(() => sqlHex32InClause(["0x1111111111111111111111111111111111111111" as Hex])).toThrow();
  });
});

describe("sqlHex20Literal", () => {
  it("builds a valid, lowercased literal from a hex20 address", () => {
    const address = `0x${"AB".repeat(20)}`;
    expect(sqlHex20Literal(address)).toBe(`'${address.toLowerCase()}'`);
  });

  it("refuses a non-address value", () => {
    expect(() => sqlHex20Literal("'; DROP TABLE vault; --")).toThrow(/non-address/);
  });
});
