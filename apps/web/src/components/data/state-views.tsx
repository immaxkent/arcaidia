/**
 * Presentation for the four honest data states. Every metric, table and chart in
 * the app renders through these so nothing can silently display an invented value.
 */
import type { ReactNode } from "react";
import { DEMO_MODE } from "@/lib/arcaidia/config";
import { NOT_AVAILABLE, type DataState } from "@/lib/arcaidia/data-state";
import { cn } from "@/lib/utils";

export function ValueSkeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-[1em] w-16 animate-pulse rounded bg-newsprint/15 align-middle",
        className,
      )}
    />
  );
}

/**
 * Renders a single value from a DataState. `format` only ever receives real data.
 * Loading -> skeleton. Empty/unavailable/error -> "--" with the reason in a title.
 */
export function StateValue<T>({
  state,
  format,
  className,
  fallback = NOT_AVAILABLE,
}: {
  state: DataState<T>;
  format: (data: T) => ReactNode;
  className?: string;
  fallback?: string;
}) {
  if (state.status === "loading") return <ValueSkeleton {...(className ? { className } : {})} />;
  if (state.status === "ready") return <span className={className}>{format(state.data)}</span>;
  const reason =
    state.status === "unavailable" ? state.reason : state.status === "error" ? state.error : "No data yet";
  return (
    <span className={cn("text-text-dim/70", className)} title={reason ?? undefined}>
      {fallback}
    </span>
  );
}

/** Short explanatory line under a surface that has no wired source yet. */
export function AwaitingSource({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 border-t border-border/60 pt-2 font-mono text-[10px] uppercase tracking-wide text-text-dim/70">
      {children}
    </p>
  );
}

/** Purposeful empty state for tables, lists and charts. */
export function EmptyPanel({
  title,
  note,
  action,
  className,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <p className="font-display text-xl uppercase tracking-wide text-newsprint/80">{title}</p>
      {note ? <p className="measure mt-2 text-xs text-text-dim">{note}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Table/list body driven directly by a DataState. */
export function StateSection<T>({
  state,
  emptyTitle,
  emptyNote,
  unavailableTitle,
  unavailableNote,
  loadingRows = 3,
  action,
  children,
}: {
  state: DataState<T>;
  emptyTitle: string;
  emptyNote?: ReactNode;
  unavailableTitle?: string;
  unavailableNote?: ReactNode;
  loadingRows?: number;
  action?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: loadingRows }).map((_, i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-newsprint/8" aria-hidden />
        ))}
      </div>
    );
  }
  if (state.status === "ready") return <>{children(state.data)}</>;
  if (state.status === "error") {
    return <EmptyPanel title="Could not load" note={state.error ?? "The data source returned an error."} />;
  }
  if (state.status === "empty") return <EmptyPanel title={emptyTitle} note={emptyNote} action={action} />;
  return (
    <EmptyPanel
      title={unavailableTitle ?? emptyTitle}
      note={unavailableNote ?? state.reason ?? "This data source is not connected yet."}
      action={action}
    />
  );
}

/** Visible marker whenever demo mode is explicitly enabled (VITE_DEMO_MODE=true). */
export function DemoModeBadge() {
  if (!DEMO_MODE) return null;
  return (
    <span className="border-2 border-pink bg-pink/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-pink">
      Demo data
    </span>
  );
}

/** Empty chart frame: axes and grid, no generated curve. */
export function EmptyChart({ label }: { label: string }) {
  return (
    <div className="instrument relative flex h-40 items-center justify-center overflow-hidden p-3">
      <svg viewBox="0 0 100 40" className="absolute inset-0 size-full opacity-25" aria-hidden>
        {[10, 20, 30].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="currentColor" strokeWidth="0.2" />
        ))}
      </svg>
      <p className="relative font-mono text-[10px] uppercase tracking-widest text-text-dim">{label}</p>
    </div>
  );
}
