import { useHydrated } from "@tanstack/react-router";
import { absoluteTime, clockTime, relativeTime } from "@/lib/arcaidia/format";

/**
 * Timestamps are only rendered after hydration. Mock data anchors its times to
 * the moment the module is evaluated, which differs between server and client;
 * gating on hydration keeps the markup stable and matches how live backend
 * timestamps will behave once wired.
 */
export function TimeValue({
  at,
  mode = "relative",
  className,
}: {
  at: number;
  mode?: "relative" | "clock";
  className?: string;
}) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <span className={className} aria-hidden>
        —
      </span>
    );
  }
  return (
    <time className={className} dateTime={new Date(at * 1000).toISOString()} title={absoluteTime(at)}>
      {mode === "clock" ? clockTime(at) : relativeTime(at)}
    </time>
  );
}
