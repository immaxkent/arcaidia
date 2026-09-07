import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DirectionPills } from "@/components/site/chain-pill";
import { DecisionInputsReadout, TransportBadge, VerdictBadge } from "@/components/transfer/decision-panel";
import { ARC_TESTNET, ETHEREUM_SEPOLIA, type AgentDecision } from "@/lib/arcaidia/types";
import { formatBps, formatUsdc } from "@/lib/arcaidia/format";
import { TimeValue } from "@/components/site/time-value";
import { AwaitingSource, EmptyChart, StateSection, StateValue } from "@/components/data/state-views";
import { mapState } from "@/lib/arcaidia/data-state";
import { SUPPORTED_CHAIN_IDS } from "@/lib/arcaidia/config";
import { useSolverActivityStats, useSolverDecisions } from "@/hooks/arcaidia/use-solver-decisions";

export const Route = createFileRoute("/solver")({
  head: () => ({
    meta: [
      { title: "Solver activity — Arcaidia" },
      {
        name: "description",
        content:
          "Console of the Arcaidia solver: every verdict, the quoted fee, and the exact liquidity and settlement inputs behind each decision.",
      },
      { property: "og:title", content: "Solver activity — Arcaidia" },
      {
        property: "og:description",
        content: "Accepts, rejects and pauses with the full decision readout behind each one.",
      },
    ],
  }),
  component: SolverPage,
});

type Filter = "ALL" | "ACCEPT" | "REJECT" | "PAUSE";

function Row({ decision }: { decision: AgentDecision }) {
  const [open, setOpen] = useState(false);
  const source = decision.inputsUsed ? decision.intentId && ETHEREUM_SEPOLIA : ETHEREUM_SEPOLIA;
  const destination = source === ETHEREUM_SEPOLIA ? ARC_TESTNET : ETHEREUM_SEPOLIA;

  return (
    <li className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="grid w-full grid-cols-[auto_1fr] items-center gap-3 px-3 py-3 text-left md:grid-cols-[6rem_auto_9rem_6rem_5rem_1fr]"
      >
        <TimeValue at={decision.decidedAt} className="num text-xs text-text-dim" />
        <DirectionPills from={ETHEREUM_SEPOLIA} to={destination} />
        <span className="num text-sm text-text">{formatUsdc(decision.inputsUsed.requestedAmount)} USDC</span>
        <span>
          <VerdictBadge verdict={decision.verdict} />
        </span>
        <span className="num text-xs text-text-dim" title={`${decision.feeBps} bps`}>
          {decision.verdict === "ACCEPT" ? formatBps(decision.feeBps) : "—"}
        </span>
        <span className="num text-xs text-text-dim">{decision.verdict === "ACCEPT" ? "" : decision.reason}</span>
      </button>
      {open ? (
        <div className="px-3 pb-4">
          <DecisionInputsReadout decision={decision} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * HANDOFF — this page renders only real solver decisions.
 * WIRE: useSolverDecisions (decision feed / indexed outcomes) and
 * useSolverActivityStats (aggregates computed from those same rows).
 */
function SolverPage() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const decisions = useSolverDecisions(SUPPORTED_CHAIN_IDS);
  const stats = useSolverActivityStats(SUPPORTED_CHAIN_IDS);

  const filtered = useMemo(
    () => mapState(decisions, (rows) => (filter === "ALL" ? rows : rows.filter((d) => d.verdict === filter))),
    [decisions, filter],
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold text-text sm:text-3xl">Solver</h1>
      <p className="measure mt-2 text-sm text-text-dim">
        Every decision the agent makes, with the inputs it used. Deterministic policy, published in the open.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="panel p-4">
          <p className="text-xs tracking-wide text-text-dim uppercase">Decisions · last hour</p>
          <p className="num mt-1 text-2xl text-text">
            <StateValue state={stats} format={(s) => (s.decisionCount === null ? "--" : s.decisionCount)} />
          </p>
        </div>
        <div className="panel p-4">
          <p className="text-xs tracking-wide text-text-dim uppercase">Accept rate</p>
          <p className="num mt-1 text-2xl text-electric-glow">
            <StateValue
              state={stats}
              format={(s) => (s.acceptRateBps === null ? "--" : formatBps(s.acceptRateBps))}
            />
          </p>
        </div>
        <div className="panel p-4">
          <p className="text-xs tracking-wide text-text-dim uppercase">Median quoted fee</p>
          <p className="num mt-1 text-2xl text-text">
            <StateValue state={stats} format={(s) => (s.medianFeeBps === null ? "--" : formatBps(s.medianFeeBps))} />
          </p>
          <div className="mt-2">
            <EmptyChart label="Fee history — awaiting indexed decisions" />
          </div>
        </div>
        <div className="panel flex flex-col justify-center gap-2 p-4">
          <p className="text-xs tracking-wide text-text-dim uppercase">Transport</p>
          {stats.status === "ready" && stats.data.transport ? (
            <TransportBadge transport={stats.data.transport} />
          ) : (
            <p className="num text-sm text-text-dim/70">--</p>
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        {(
          [
            ["ALL", "All"],
            ["ACCEPT", "Accepted"],
            ["REJECT", "Rejected"],
            ["PAUSE", "Paused"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === key
                ? "border-electric/60 bg-electric/15 text-electric-glow"
                : "border-border text-text-dim hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="panel mt-4">
        <StateSection
          state={filtered}
          emptyTitle="No decisions yet"
          emptyNote="Decisions appear here as the solver publishes them."
          unavailableTitle="No decisions yet"
          unavailableNote="The decision feed is not connected yet, so nothing is shown."
        >
          {(rows) => (
            <ul>
              {rows.map((d) => (
                <Row key={d.intentId} decision={d} />
              ))}
            </ul>
          )}
        </StateSection>
      </div>
      <AwaitingSource>
        Policy version{" "}
        <StateValue state={stats} format={(s) => s.policyVersion ?? "--"} /> — read from the deployed policy
      </AwaitingSource>
    </div>
  );
}
