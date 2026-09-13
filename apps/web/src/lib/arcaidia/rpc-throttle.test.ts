import { describe, expect, it } from "vitest";
import { inFlightFor, throttledFetch } from "./rpc-throttle";

const URL_A = "https://rpc.example/a";

describe("throttledFetch", () => {
  it("never lets more than maxConcurrent requests to one host be in flight", async () => {
    let peak = 0;
    let active = 0;
    const fetchImpl = (async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const f = throttledFetch({ maxConcurrent: 2, fetchImpl });

    await Promise.all(Array.from({ length: 9 }, () => f(URL_A)));
    expect(peak).toBe(2);
    expect(inFlightFor("rpc.example")).toBe(0);
  });

  it("retries a 429 with backoff and returns the eventual success", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("", { status: calls < 3 ? 429 : 200 });
    }) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const f = throttledFetch({ maxConcurrent: 1, fetchImpl, sleepFn: async (ms) => { sleeps.push(ms); } });

    const response = await f("https://rpc.example/b");
    expect(response.status).toBe(200);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("retries a dropped connection (fetch TypeError) but not other errors", async () => {
    let calls = 0;
    const dropping = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const f = throttledFetch({ maxConcurrent: 1, fetchImpl: dropping, sleepFn: async () => {} });
    expect((await f("https://rpc.example/c")).status).toBe(200);

    const broken = (async () => { throw new Error("aborted"); }) as unknown as typeof fetch;
    const g = throttledFetch({ maxConcurrent: 1, fetchImpl: broken, sleepFn: async () => {} });
    await expect(g("https://rpc.example/d")).rejects.toThrow("aborted");
  });

  it("gives up after four attempts and hands back the last 429 rather than hanging", async () => {
    const fetchImpl = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    const f = throttledFetch({ maxConcurrent: 1, fetchImpl, sleepFn: async () => {} });
    expect((await f("https://rpc.example/e")).status).toBe(429);
  });
});
