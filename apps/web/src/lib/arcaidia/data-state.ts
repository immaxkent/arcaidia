/**
 * Single state contract for every data-driven surface in the app.
 *
 * INTEGRATION NOTE
 * ----------------
 * Nothing in this codebase invents operational values. Every component that
 * displays protocol data takes a `DataState<T>` and renders:
 *   loading      -> skeleton
 *   ready        -> the real value (including a genuine zero)
 *   empty        -> "No … yet" (the source answered, there is nothing)
 *   unavailable  -> "--" / "Not available yet" (no source wired / not in V1)
 *   error        -> error message
 *
 * A zero is real data. Only render it when the queried source returned zero.
 */
export type DataState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "empty" }
  | { status: "unavailable"; reason?: string }
  | { status: "error"; error?: string };

export const loadingState = (): { status: "loading" } => ({ status: "loading" });
export const readyState = <T,>(data: T): DataState<T> => ({ status: "ready", data });
export const emptyState = (): { status: "empty" } => ({ status: "empty" });
export const unavailableState = (reason?: string): { status: "unavailable"; reason?: string } => ({
  status: "unavailable",
  ...(reason ? { reason } : {}),
});
export const errorState = (error?: string): { status: "error"; error?: string } => ({
  status: "error",
  ...(error ? { error } : {}),
});

/** Placeholder for a value that has no wired source yet. Never a fabricated number. */
export const NOT_AVAILABLE = "--";

export const NOT_AVAILABLE_YET = "Not available yet";

export function isReady<T>(state: DataState<T>): state is { status: "ready"; data: T } {
  return state.status === "ready";
}

export function dataOrNull<T>(state: DataState<T>): T | null {
  return state.status === "ready" ? state.data : null;
}

/** Map a ready value, preserving every non-ready state verbatim. */
export function mapState<T, U>(state: DataState<T>, fn: (value: T) => U): DataState<U> {
  return state.status === "ready" ? { status: "ready", data: fn(state.data) } : state;
}

/** Collapse a ready-but-empty list into the `empty` state. */
export function listState<T>(state: DataState<T[]>): DataState<T[]> {
  if (state.status === "ready" && state.data.length === 0) return { status: "empty" };
  return state;
}
