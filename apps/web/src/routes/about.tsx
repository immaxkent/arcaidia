import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "How value moves — Arcaidia in ten stages" },
      {
        name: "description",
        content:
          "A ten-stage walkthrough of a single Arcaidia transfer: intent, CCTP commitment, independent verification, the priced advance, and the vault reimbursement minutes later.",
      },
      { property: "og:title", content: "How value moves — Arcaidia in ten stages" },
      {
        property: "og:description",
        content: "Follow one transfer from signature to vault reimbursement, one stage at a time.",
      },
    ],
  }),
  component: AboutPage,
});

const STAGES = [
  {
    title: "You express an intent",
    body: "“1,000 USDC on Ethereum. Send it to this address on Arc. I'll pay at most 0.3%.” You sign once. Nothing has moved yet.",
    tone: "electric",
  },
  {
    title: "Your money enters Circle's pipe",
    body: "Arcaidia's router takes your USDC and hands it to CCTP in the same transaction. If the handoff fails, the whole thing reverts and you keep your money. There is no cancel button after this — and that's the point.",
    tone: "gold",
  },
  {
    title: "The commitment is announced",
    body: "The router emits an event that can only exist if the funds were committed. Anyone watching can verify it.",
    tone: "electric",
  },
  {
    title: "An indexer picks it up",
    body: "The Graph records the intent within seconds and shows it to the solver. But the indexer is not trusted — it says where to look, not what is true.",
    tone: "electric",
  },
  {
    title: "The solver checks the chain itself",
    body: "It re-reads your transaction directly from an Ethereum node: right router, right amount, right recipient, CCTP actually started, enough confirmations. Only now will it consider risking capital.",
    tone: "electric",
  },
  {
    title: "It prices the wait",
    body: "How much liquidity is free? How much is already advanced? Is Circle settling on time? A deterministic engine — no AI in the decision — returns a fee and a verdict.",
    tone: "electric",
  },
  {
    title: "It signs a narrow permission",
    body: "Not “send money” — a signed statement about this intent, to this recipient, for this amount, valid for 45 seconds.",
    tone: "electric",
  },
  {
    title: "You're paid",
    body: "The destination vault checks the signature and ten other conditions, then sends the recipient 999 USDC. Seconds have passed. For you, it's over.",
    tone: "electric",
  },
  {
    title: "Circle takes its time",
    body: "The canonical transfer is still travelling. Minutes, not seconds. The liquidity provider is carrying your transfer on their books.",
    tone: "gold",
  },
  {
    title: "The vault is repaid",
    body: "1,000 USDC arrives and reimburses the provider, who keeps the 1 USDC fee for the minutes of risk. And if no solver had shown up? Circle would simply have paid you directly. Arcaidia makes it faster; it is never required.",
    tone: "gold",
  },
] as const;

function AboutPage() {
  const [index, setIndex] = useState(0);
  const touchStart = useRef<number | null>(null);

  const go = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(STAGES.length - 1, next));
    setIndex(clamped);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#stage-${clamped + 1}`);
    }
  }, []);

  useEffect(() => {
    const hash = window.location.hash.match(/^#stage-(\d+)$/);
    if (hash?.[1]) setIndex(Math.max(0, Math.min(STAGES.length - 1, Number(hash[1]) - 1)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") go(index + 1);
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go]);

  const stage = STAGES[index]!;
  const gold = stage.tone === "gold";

  return (
    <div
      className="relative flex min-h-[calc(100svh-3.5rem)] flex-col"
      onClick={() => go(index + 1)}
      onTouchStart={(e) => {
        touchStart.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        const end = e.changedTouches[0]?.clientX;
        if (start == null || end == null) return;
        if (Math.abs(end - start) > 40) go(index + (end < start ? 1 : -1));
      }}
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 items-center px-4 py-16 sm:px-6">
        <article className="max-w-3xl" aria-live="polite">
          <p className={`num text-xs tracking-[0.2em] uppercase ${gold ? "text-gold-glow" : "text-electric-glow"}`}>
            Stage {index + 1} of {STAGES.length}
          </p>
          <h1 className="mt-5 text-3xl leading-[1.1] font-bold text-text sm:text-5xl">{stage.title}</h1>
          <p className="measure mt-6 text-base text-text-dim sm:text-lg">{stage.body}</p>
          <div className="mt-10 flex items-center gap-4 text-sm">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(index - 1);
              }}
              disabled={index === 0}
              className="text-text-dim hover:text-text disabled:opacity-40"
            >
              ← Back
            </button>
            {index === STAGES.length - 1 ? (
              <Link
                to="/transfer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-lg bg-electric px-4 py-2 font-semibold text-primary-foreground glow-electric"
              >
                Start a transfer
              </Link>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  go(index + 1);
                }}
                className="text-text hover:text-electric-glow"
              >
                Next →
              </button>
            )}
            <span className="text-xs text-text-dim">Click, swipe, or use arrow keys</span>
          </div>
        </article>
      </div>

      <nav aria-label="Stages" className="mx-auto mb-10 w-full max-w-[1400px] px-4 sm:px-6">
        <ol className="flex gap-1.5">
          {STAGES.map((s, i) => (
            <li key={s.title} className="flex-1">
              <button
                type="button"
                aria-label={`Stage ${i + 1}: ${s.title}`}
                aria-current={i === index}
                onClick={(e) => {
                  e.stopPropagation();
                  go(i);
                }}
                className={`h-1 w-full rounded-full transition-colors ${
                  i === index
                    ? s.tone === "gold"
                      ? "bg-gold"
                      : "bg-electric"
                    : i < index
                      ? "bg-text-dim/70"
                      : "bg-border"
                }`}
              />
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
