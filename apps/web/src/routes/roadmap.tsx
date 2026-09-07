import { createFileRoute } from "@tanstack/react-router";
import { ROADMAP_STAGES, type RoadmapStatus } from "@/lib/arcaidia/content";

export const Route = createFileRoute("/roadmap")({
  head: () => ({
    meta: [
      { title: "Protocol roadmap — Arcaidia" },
      {
        name: "description",
        content:
          "The Arcaidia sequence: house fast settlement, then a permissionless intent market, richer pricing, trust minimisation, security review, network expansion and token-to-token execution.",
      },
      { property: "og:title", content: "Protocol roadmap — Arcaidia" },
      {
        property: "og:description",
        content: "Shipped, building and planned — the credible path from house liquidity to a permissionless vault market.",
      },
    ],
  }),
  component: RoadmapPage,
});

const STATUS: Record<RoadmapStatus, { label: string; chip: string; rail: string }> = {
  SHIPPED: {
    label: "Shipped",
    chip: "border-success/50 bg-success/10 text-success",
    rail: "bg-success",
  },
  BUILDING: {
    label: "Building",
    chip: "border-acid/60 bg-acid/10 text-acid",
    rail: "bg-acid",
  },
  PLANNED: {
    label: "Planned",
    chip: "border-border bg-surface-raised text-text-dim",
    rail: "bg-brass",
  },
};

function RoadmapPage() {
  const currentIndex = ROADMAP_STAGES.reduce(
    (acc, stage, i) => (stage.status === "PLANNED" ? acc : i),
    0,
  );
  return (

    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <p className="num text-xs uppercase tracking-[0.3em] text-acid">Protocol evolution</p>
      <h1 className="font-display text-4xl uppercase text-newsprint sm:text-5xl">Roadmap</h1>
      <p className="measure mt-2 text-sm text-text-dim">
        The order matters more than the dates. Arcaidia starts with a house vault and a first-party solver,
        then opens the market to independent solver vaults, then reduces the trust it asks for. Nothing below
        is described as trustless before the settlement path actually is.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {(Object.keys(STATUS) as RoadmapStatus[]).map((s) => (
          <span
            key={s}
            className={`num rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${STATUS[s].chip}`}
          >
            {STATUS[s].label}
          </span>
        ))}
      </div>

      <div className="mt-8 flex gap-4 sm:gap-6">
        <div className="relative w-4 shrink-0 sm:w-5" aria-hidden="true">
          <div className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 border border-brass bg-void">
            <div
              className="w-full bg-acid shadow-neon-acid transition-[height]"
              style={{ height: `${((currentIndex + 1) / ROADMAP_STAGES.length) * 100}%` }}
            />
          </div>
          <ul className="relative flex h-full flex-col justify-between py-1">
            {ROADMAP_STAGES.map((stage, i) => (
              <li
                key={stage.stage}
                className={`mx-auto size-3 rotate-45 border ${
                  i <= currentIndex
                    ? "border-acid bg-acid shadow-neon-acid"
                    : "border-brass bg-surface-raised"
                }`}
              />
            ))}
          </ul>
        </div>

        <ol className="flex-1 space-y-4">
          {ROADMAP_STAGES.map((stage, i) => {
            const s = STATUS[stage.status];
            return (
              <li key={stage.stage} className="panel relative overflow-hidden p-5 pl-6">
                <span className={`absolute inset-y-0 left-0 w-1 ${s.rail}`} aria-hidden="true" />
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="num text-xs text-text-dim">{String(i + 1).padStart(2, "0")}</span>
                  <h2 className="font-display text-2xl uppercase text-newsprint">{stage.stage}</h2>
                  <span
                    className={`num rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.chip}`}
                  >
                    {s.label}
                  </span>
                </div>
                <p className="measure mt-2 text-sm text-text-dim">{stage.capability}</p>
                <ul className="mt-3 grid gap-1.5 text-sm text-text sm:grid-cols-2">
                  {stage.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-electric" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>


      <section className="panel mt-8 p-5">
        <h2 className="font-display text-2xl uppercase text-newsprint">What we are not claiming</h2>
        <ul className="measure mt-2 space-y-2 text-sm text-text-dim">
          <li>Reimbursement is not trustless yet — the CCTP-to-intent binding and permissionless settlement path are still being built.</li>
          <li>Execution is first valid fill, not best price. No auction, no guaranteed best quote.</li>
          <li>The Graph is the discovery and indexing layer. It is not a bridge and not a source of crosschain proof.</li>
          <li>No yield history exists yet, so no APY is shown anywhere in this app.</li>
        </ul>
      </section>
    </div>
  );
}
