import { useMemo } from "react";
import type { SolverAuthState, SolverRuntimeStatus, SolverStageId, SolverStageSource } from "@/lib/arcaidia/types";
import { SOLVER_STAGES } from "@/lib/arcaidia/content";
import type { DataState } from "@/lib/arcaidia/data-state";
import type { SolverTelemetry } from "@/hooks/arcaidia/use-solver-telemetry";

/**
 * HANDOFF — solver visual. There is NO simulation in here.
 *
 * Pre-chain stages (INTENT_DISCOVERED / VERIFYING_SOURCE / FORMULATING_FILL /
 * SUBMITTING_SETTLEMENT) come only from a real telemetry heartbeat.
 * Onchain-confirmed stages (AWAITING_CONFIRMATION onward, LOST_RACE, SETTLED)
 * come only from RPC / contract / The Graph and always override telemetry.
 *
 * With no heartbeat the orb animates in neutral standby and is labelled
 * SOLVER OFFLINE / AWAITING SOLVER — never SCANNING.
 */
const HEARTBEAT_TIMEOUT_SECONDS = 45;

export function SolverOrb({
  telemetry,
  runtimeStatus,
  authState,
  onchainStage = null,
}: {
  telemetry: DataState<SolverTelemetry>;
  runtimeStatus: SolverRuntimeStatus | null;
  authState: SolverAuthState | null;
  /** Confirmed onchain stage, when a real transaction state exists. */
  onchainStage?: SolverStageId | null;
}) {
  const beat = telemetry.status === "ready" ? telemetry.data : null;
  const heartbeatFresh =
    beat !== null && Date.now() / 1000 - beat.lastHeartbeatAt < HEARTBEAT_TIMEOUT_SECONDS;

  /** Onchain state wins; telemetry may only supply pre-chain stages. */
  const activeStage: SolverStageId | null =
    onchainStage ?? (heartbeatFresh ? (beat?.stage ?? "SCANNING") : null);
  const lost = onchainStage === "LOST_RACE";
  const live = heartbeatFresh || onchainStage !== null;

  const headline = useMemo<{ text: string; tone: string }>(() => {
    if (runtimeStatus === "PAUSED") return { text: "Paused", tone: "text-warning" };
    if (lost) return { text: "Lost race / not executed", tone: "text-pink" };
    if (activeStage) {
      const meta = SOLVER_STAGES.find((s) => s.id === activeStage);
      return {
        text: meta?.label ?? activeStage,
        tone: meta?.source === "ONCHAIN" ? "text-gold-glow" : "text-electric-glow",
      };
    }
    if (authState !== "AUTHORISED") return { text: "Awaiting solver", tone: "text-text-dim" };
    return { text: "Solver offline", tone: "text-text-dim" };
  }, [runtimeStatus, lost, activeStage, authState]);

  const stageIndex = activeStage ? SOLVER_STAGES.findIndex((s) => s.id === activeStage) : -1;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(240px,320px)_1fr]">
      <div className="relative mx-auto flex h-[260px] w-[260px] items-center justify-center">
        <span
          aria-hidden
          className={`absolute inset-0 rounded-full blur-2xl transition-colors duration-700 ${
            lost ? "bg-pink/25" : live ? "bg-acid/20" : "bg-brass/10"
          }`}
        />
        <span
          aria-hidden
          className={`absolute inset-4 rounded-full border-2 ${
            lost ? "border-pink/70" : live ? "border-acid/70" : "border-brass/60"
          } orb-spin`}
          style={{ borderStyle: "dashed" }}
        />
        <span
          aria-hidden
          className={`absolute inset-10 rounded-full border ${live ? "border-electric/60" : "border-border"} orb-spin-reverse`}
        />
        <span
          aria-hidden
          className={`absolute inset-16 rounded-full bg-linear-to-br ${
            lost ? "from-pink/50 to-void" : live ? "from-acid/50 via-electric/30 to-void" : "from-brass/20 to-void"
          } orb-pulse`}
        />
        <div className="relative z-10 text-center">
          <p className="num text-[10px] uppercase tracking-[0.3em] text-text-dim">Solver</p>
          <p className={`font-display mt-1 text-2xl uppercase leading-tight ${headline.tone}`}>{headline.text}</p>
          {stageIndex >= 0 ? (
            <p className="num mt-1 text-[10px] uppercase tracking-wide text-text-dim">
              {stageIndex + 1} / {SOLVER_STAGES.length}
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-display text-xl uppercase text-newsprint">Execution timeline</h3>
          <SourceKey source="TELEMETRY" />
          <SourceKey source="ONCHAIN" />
        </div>
        <ol className="mt-3 space-y-1.5">
          {SOLVER_STAGES.map((s, i) => (
            <li key={s.id}>
              <StageRow
                id={s.id}
                label={s.label}
                source={s.source}
                reached={stageIndex >= i}
                current={stageIndex === i}
              />
            </li>
          ))}
          {lost ? (
            <li>
              <StageRow
                id="LOST_RACE"
                label="Lost race / not executed"
                source="ONCHAIN"
                reached
                current
              />
            </li>
          ) : null}
        </ol>
        <p className="num mt-3 text-[11px] uppercase tracking-wide text-text-dim/80">
          {telemetry.status === "ready"
            ? "Pre-chain stages from solver telemetry; confirmed stages from contract and indexer reads"
            : telemetry.status === "loading"
              ? "Connecting to solver telemetry…"
              : "Telemetry unavailable — no live stages are shown until a real heartbeat arrives"}
        </p>
      </div>
    </div>
  );
}

function SourceKey({ source }: { source: SolverStageSource }) {
  const onchain = source === "ONCHAIN";
  return (
    <span
      className={`num rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
        onchain ? "border-gold/50 bg-gold/10 text-gold-glow" : "border-electric/50 bg-electric/10 text-electric-glow"
      }`}
    >
      {onchain ? "Onchain confirmed" : "Solver telemetry"}
    </span>
  );
}

function StageRow({
  id,
  label,
  source,
  reached,
  current,
}: {
  id: SolverStageId;
  label: string;
  source: SolverStageSource;
  reached: boolean;
  current: boolean;
}) {
  const onchain = source === "ONCHAIN";
  return (
    <div
      aria-current={current || undefined}
      className={`flex items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
        current
          ? onchain
            ? "border-gold/70 bg-gold/10"
            : "border-electric/70 bg-electric/10"
          : reached
            ? "border-border bg-surface-raised"
            : "border-border/60 bg-transparent opacity-60"
      }`}
    >
      <span
        aria-hidden
        className={`h-2.5 w-2.5 shrink-0 ${onchain ? "rounded-sm" : "rounded-full"} ${
          reached ? (onchain ? "bg-gold" : "bg-electric") : "bg-border"
        }`}
      />
      <span className={`num text-xs uppercase tracking-wide ${reached ? "text-text" : "text-text-dim"}`}>
        {label}
      </span>
      <span className="num ml-auto text-[10px] uppercase tracking-wide text-text-dim/70">
        {id === "LOST_RACE" ? "outcome" : onchain ? "chain" : "telemetry"}
      </span>
    </div>
  );
}
