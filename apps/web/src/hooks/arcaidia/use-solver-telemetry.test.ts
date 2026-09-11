import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Address } from "@/lib/arcaidia/types";
import { useSolverTelemetry } from "./use-solver-telemetry";

const VAULT: Address = "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1";
const CHAIN_ID = 11155111;

/**
 * `SERVICES.solverTelemetryUrl` is a module-level singleton derived from
 * `import.meta.env` once, at import time — `vi.stubEnv` runs far too late to
 * affect an already-evaluated value. Mocking the config module itself, via a
 * `vi.hoisted` ref both this factory and the tests below can read/write, is
 * what actually makes the "no Relay configured" case reachable. `vi.mock`
 * calls are hoisted above every import in this file by Vitest's own
 * transform, so this runs before `use-solver-telemetry.ts` ever resolves its
 * import of the real config module.
 */
const relayUrlRef = vi.hoisted(() => ({ value: "https://relay.example" as string | null }));
vi.mock("@/lib/arcaidia/config", () => ({
  SERVICES: {
    get solverTelemetryUrl() {
      return relayUrlRef.value;
    },
  },
}));

/**
 * A controllable fake of the browser's `EventSource`, since jsdom doesn't
 * implement one. Tests drive it directly — `emit(data)` for a message frame,
 * `error()` for a connection failure — and can inspect every instance ever
 * constructed (`FakeEventSource.instances`) to assert the hook opened the
 * right URL, and closed the right connection at the right time.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  error(): void {
    this.onerror?.();
  }

  close(): void {
    this.closed = true;
  }
}

const relayState = (overrides: Record<string, unknown> = {}) => ({
  chainId: CHAIN_ID,
  vaultAddress: VAULT.toLowerCase(),
  operatorAddress: null,
  paired: false,
  online: false,
  lastHeartbeatAt: null,
  stage: null,
  stageAt: null,
  intentId: null,
  ...overrides,
});

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  relayUrlRef.value = "https://relay.example";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSolverTelemetry", () => {
  it("reports unavailable with no vault deployed, and opens no connection", () => {
    const { result } = renderHook(() => useSolverTelemetry(CHAIN_ID, null));

    expect(result.current).toEqual({ status: "unavailable", reason: "Deploy vault first" });
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("opens the stream at the exact chain-scoped URL WP-18.4 defines", () => {
    renderHook(() => useSolverTelemetry(CHAIN_ID, VAULT));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe(
      `https://relay.example/v1/telemetry/vault/${CHAIN_ID}/${VAULT}/stream`,
    );
  });

  it("starts loading, then goes ready the instant the Relay's first snapshot arrives", async () => {
    const { result } = renderHook(() => useSolverTelemetry(CHAIN_ID, VAULT));
    expect(result.current.status).toBe("loading");

    act(() => {
      FakeEventSource.instances[0]!.emit(relayState({ paired: true, online: true, lastHeartbeatAt: 42 }));
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data).toMatchObject({ paired: true, online: true, lastHeartbeatAt: 42 });
  });

  it("passes through a genuine pre-chain stage", async () => {
    const { result } = renderHook(() => useSolverTelemetry(CHAIN_ID, VAULT));

    act(() => {
      FakeEventSource.instances[0]!.emit(
        relayState({ paired: true, online: true, stage: "VERIFYING_SOURCE", stageAt: 100, intentId: "0xabc" }),
      );
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.stage).toBe("VERIFYING_SOURCE");
    expect(result.current.data.intentId).toBe("0xabc");
  });

  /// WP-18.3's rejection is server-side; this is the client-side belt: even if
  /// a stray non-pre-chain value ever reached the wire, the hook must never
  /// hand it to the orb as a "stage".
  it("never surfaces a non-pre-chain stage value, even if one arrived on the wire", async () => {
    const { result } = renderHook(() => useSolverTelemetry(CHAIN_ID, VAULT));

    act(() => {
      FakeEventSource.instances[0]!.emit(relayState({ paired: true, stage: "FAST_FILL_CONFIRMED" }));
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.stage).toBeNull();
  });

  it("goes unavailable, not stuck on stale data, when the connection errors", async () => {
    const { result } = renderHook(() => useSolverTelemetry(CHAIN_ID, VAULT));

    act(() => {
      FakeEventSource.instances[0]!.emit(relayState({ paired: true, online: true }));
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      FakeEventSource.instances[0]!.error();
    });

    expect(result.current.status).toBe("unavailable");
  });

  it("closes the old connection and opens a fresh one when the vault changes", () => {
    const { rerender } = renderHook(({ vault }: { vault: Address }) => useSolverTelemetry(CHAIN_ID, vault), {
      initialProps: { vault: VAULT },
    });
    const first = FakeEventSource.instances[0]!;

    const otherVault: Address = "0x0000000000000000000000000000000000000001";
    rerender({ vault: otherVault });

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]?.url).toContain(otherVault);
  });

  it("resets to loading on a vault change, rather than showing the previous vault's telemetry", async () => {
    const { result, rerender } = renderHook(
      ({ vault }: { vault: Address }) => useSolverTelemetry(CHAIN_ID, vault),
      { initialProps: { vault: VAULT } },
    );

    act(() => {
      FakeEventSource.instances[0]!.emit(relayState({ paired: true, online: true }));
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const otherVault: Address = "0x0000000000000000000000000000000000000001";
    rerender({ vault: otherVault });

    expect(result.current.status).toBe("loading");
  });

  it("closes the connection on unmount", () => {
    const { unmount } = renderHook(() => useSolverTelemetry(CHAIN_ID, VAULT));
    const source = FakeEventSource.instances[0]!;

    unmount();

    expect(source.closed).toBe(true);
  });

  it("reports unavailable, and opens no connection, when no Relay URL is configured", () => {
    relayUrlRef.value = null;
    const { result } = renderHook(() => useSolverTelemetry(CHAIN_ID, VAULT));

    expect(result.current).toEqual({ status: "unavailable", reason: "Telemetry unavailable" });
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
