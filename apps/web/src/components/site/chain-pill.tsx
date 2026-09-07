import { CHAINS, ETHEREUM_SEPOLIA } from "@/lib/arcaidia/types";
import { cn } from "@/lib/utils";

export function ChainPill({ chainId, className }: { chainId: number; className?: string }) {
  const meta = CHAINS[chainId];
  const isEth = chainId === ETHEREUM_SEPOLIA;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        isEth
          ? "border-electric/35 bg-electric/10 text-electric-glow"
          : "border-gold/35 bg-gold/10 text-gold-glow",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", isEth ? "bg-electric" : "bg-gold")} />
      {meta?.short ?? `Chain ${chainId}`}
    </span>
  );
}

export function DirectionPills({ from, to }: { from: number; to: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <ChainPill chainId={from} />
      <span aria-label="to" className="text-text-dim">
        →
      </span>
      <ChainPill chainId={to} />
    </span>
  );
}
