import { useState } from "react";
import type { AgentDecision, Verdict } from "@/lib/arcaidia/types";
import { formatBps, formatDuration, formatUsdc } from "@/lib/arcaidia/format";
import { cn } from "@/lib/utils";
import { SERVICES } from "@/lib/arcaidia/config";

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={cn(
        "num rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide",
        verdict === "ACCEPT" && "border-electric/50 bg-electric/10 text-electric-glow",
        verdict === "REJECT" && "border-danger/50 bg-danger/10 text-danger",
        verdict === "PAUSE" && "border-warning/50 bg-warning/10 text-warning",
      )}
    >
      {verdict}
    </span>
  );
}

export function TransportBadge({
  transport,
}: {
  transport: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
}) {
  const label = transport === "HEALTHY" ? "Healthy" : transport === "DEGRADED" ? "Slowing" : "Unavailable";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
        transport === "HEALTHY" && "border-success/40 bg-success/10 text-success",
        transport === "DEGRADED" && "border-warning/40 bg-warning/10 text-warning",
        transport === "UNAVAILABLE" && "border-danger/40 bg-danger/10 text-danger",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          transport === "HEALTHY" && "bg-success",
          transport === "DEGRADED" && "bg-warning",
          transport === "UNAVAILABLE" && "bg-danger",
        )}
      />
      Transport {label}
    </span>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border/60 py-2.5 last:border-0">
      <dt className="text-xs tracking-wide text-text-dim uppercase">{label}</dt>
      <dd className="num text-sm text-text" title={hint}>
        {value}
      </dd>
    </div>
  );
}

export function DecisionInputsReadout({ decision }: { decision: AgentDecision }) {
  const i = decision.inputsUsed;
  return (
    <dl className="grid gap-x-8 md:grid-cols-2">
      <Row label="Requested amount" value={`${formatUsdc(i.requestedAmount)} USDC`} />
      <Row label="Available liquidity" value={`${formatUsdc(i.availableLiquidity)} USDC`} />
      <Row label="Reserve floor" value={`${formatUsdc(i.reserveFloor)} USDC`} hint="Capital this vault keeps unadvanced at all times (its reserveFloorBps of total assets). Unrelated to what is awaiting settlement." />
      <Row label="Outstanding exposure" value={`${formatUsdc(i.outstandingExposure)} USDC`} />
      <Row label="Utilisation" value={formatBps(i.utilisationBps)} hint={`${i.utilisationBps} bps`} />
      <Row label="Your fee ceiling" value={formatBps(i.userMaxFeeBps)} hint={`${i.userMaxFeeBps} bps`} />
      <Row
        label="Quoted fee"
        value={`${formatBps(decision.feeBps)} · ${formatUsdc(decision.feeAmount)} USDC`}
        hint={`${decision.feeBps} bps`}
      />
      <Row
        label="Confirmations"
        value={`${i.sourceConfirmations} / ${i.requiredConfirmations}`}
      />
      <Row label="Observation age" value={formatDuration(i.observationAgeSeconds)} />
      <Row label="Transport" value={<TransportBadge transport={i.settlementHealth.transport} />} />
      <Row
        label="Oldest unsettled intent"
        value={
          i.settlementHealth.oldestUnsettledAgeSeconds === null
            ? "none"
            : formatDuration(i.settlementHealth.oldestUnsettledAgeSeconds)
        }
        hint="Market-wide: the oldest intent whose canonical CCTP settlement has not landed yet. The solver pauses when this exceeds its policy's limit."
      />
      <Row label="Awaiting canonical settlement" value={`${formatUsdc(i.settlementHealth.pendingValue)} USDC`} hint="Market-wide: the value of every intent (any vault, filled or not) still waiting for CCTP to deliver. Not this vault's exposure." />
      <Row
        label="Avg settlement latency"
        value={
          i.settlementHealth.averageSettlementLatencySeconds === null
            ? "unknown"
            : formatDuration(i.settlementHealth.averageSettlementLatencySeconds)
        }
      />
      <Row label="Output amount" value={`${formatUsdc(decision.outputAmount)} USDC`} />
      <Row label="Policy version" value={decision.policyVersion} />
      <Row label="Reason" value={decision.reason} />
    </dl>
  );
}

export function DecisionPanel({ decision }: { decision: AgentDecision | null }) {
  const [open, setOpen] = useState(true);

  if (!decision) {
    return (
      <section className="panel p-5">
        <h3 className="text-sm font-semibold tracking-wide text-text uppercase">Agent decision</h3>
        <p className="mt-2 text-sm text-text-dim">
          No quote yet — the solver publishes its inputs the moment it decides.
        </p>
      </section>
    );
  }

  return (
    <section className="panel p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
      >
        <h3 className="text-sm font-semibold tracking-wide text-text uppercase">Agent decision</h3>
        <VerdictBadge verdict={decision.verdict} />
        <span className="num text-[10px] uppercase tracking-wide text-text-dim/70" title={SERVICES.solverQuoteUrl ?? undefined}>
          House solver
        </span>
        <span className="num text-[10px] uppercase tracking-wide text-text-dim/70">Estimated</span>
        <span className="num ml-auto text-xs text-text-dim">{open ? "hide inputs −" : "show inputs +"}</span>
      </button>
      {open ? (
        <div className="mt-4 leading-relaxed">
          <p className="mb-3 text-xs text-text-dim">
            This is the Arcaidia House solver's answer to your exact request, from its quote endpoint — what it would do if your
            intent appeared right now, with the inputs it decided on. Other solvers (Vault B, Vault C) decide independently and may
            win the fill instead; the first valid fill on chain is what counts.
          </p>
          <DecisionInputsReadout decision={decision} />
        </div>
      ) : null}
    </section>
  );
}
