import { useEffect, useRef, useState } from "react";
import { TokenBadge } from "./token-badge";
import { cn } from "@/lib/utils";

export interface TokenOption {
  symbol: string;
  name: string | null;
  /** The API's `display` price, or null before the first sample. */
  price: string | null;
  change24hBps: number | null;
}

/**
 * WP-34 — the "you receive" control: a styled listbox rather than a native select, with a badge,
 * the live price and the 24h change per token. Keyboard: arrows move, Enter picks, Escape closes.
 */
export function TokenPicker({ options, value, onChange, label }: { options: TokenOption[]; value: string | null; onChange: (symbol: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.symbol === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && options[active]) {
        onChange(options[active]!.symbol);
        setOpen(false);
      } else setOpen(true);
    } else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={root} className="relative">
      <p className="text-xs tracking-wide text-text-dim uppercase">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn("mt-1 flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors", open ? "border-acid/60 bg-acid/5" : "border-border hover:border-acid/40")}
      >
        {selected ? (
          <>
            <TokenBadge symbol={selected.symbol} size={28} />
            <span className="flex-1">
              <span className="block text-sm font-semibold text-text">{selected.symbol}</span>
              <span className="num block text-[11px] text-text-dim">{selected.name ?? ""}</span>
            </span>
            <span className="num text-right">
              <span className="block text-sm text-text">{selected.price ? `${selected.price} USDC` : "--"}</span>
              <Change bps={selected.change24hBps} />
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-text-dim">Pick a token</span>
        )}
        <span aria-hidden="true" className={cn("text-text-dim transition-transform", open && "rotate-180")}>⌄</span>
      </button>
      {open ? (
        <ul role="listbox" className="panel absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto p-1 shadow-xl">
          {options.map((o, i) => (
            <li
              key={o.symbol}
              role="option"
              aria-selected={o.symbol === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                onChange(o.symbol);
                setOpen(false);
              }}
              className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2", i === active ? "bg-acid/10" : "", o.symbol === value ? "border border-acid/40" : "border border-transparent")}
            >
              <TokenBadge symbol={o.symbol} size={28} />
              <span className="flex-1">
                <span className="block text-sm font-semibold text-text">{o.symbol}</span>
                <span className="num block text-[11px] text-text-dim">{o.name ?? ""}</span>
              </span>
              <span className="num text-right">
                <span className="block text-sm text-text">{o.price ? `${o.price} USDC` : "--"}</span>
                <Change bps={o.change24hBps} />
              </span>
            </li>
          ))}
          {options.length === 0 ? <li className="px-2.5 py-2 text-xs text-text-dim">No markets on this chain</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function Change({ bps }: { bps: number | null }) {
  if (bps === null) return <span className="num block text-[11px] text-text-dim">24h --</span>;
  return (
    <span className={cn("num block text-[11px]", bps >= 0 ? "text-acid" : "text-warning")}>
      {bps >= 0 ? "+" : ""}
      {(bps / 100).toFixed(2)}% 24h
    </span>
  );
}
