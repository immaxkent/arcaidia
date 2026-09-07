import { Link } from "@tanstack/react-router";
import { ArcaidiaMark } from "./arcaidia-mark";
import { WalletControl } from "./wallet-control";

// "Earn" (self-service solver vault deploy) and "Console" (solver telemetry)
// are post-V1 Intent Market surfaces — WP-INTENT-MARKET.md — not linked here
// until that work starts. The routes still exist and self-gate on config; only
// the nav entry is removed, per the shipped sequencing (V1 ships, then the
// Intent Market, including its frontend).
const ROUTES = [
  { to: "/transfer", label: "Transfer" },
  { to: "/solver", label: "Solver" },
  { to: "/liquidity", label: "Liquidity" },
  { to: "/roadmap", label: "Roadmap" },
  { to: "/docs", label: "Docs" },
  { to: "/about", label: "How it works" },
] as const;

const LINK_CLASS =
  "control-nav-link shrink-0 px-3 py-2 text-xs font-semibold uppercase text-text-dim transition-colors hover:text-acid";
const LINK_ACTIVE = { className: "text-acid bg-acid/10" };

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b-2 border-brass bg-void/90 backdrop-blur-md">
      <div className="ticker-strip h-5 overflow-hidden border-b border-acid/30 text-[10px] font-mono uppercase text-acid">
        <div className="ticker-copy whitespace-nowrap py-0.5">ARCAIDIA SIGNAL ONLINE · FAST LIQUIDITY 99.8% · CCTP SETTLEMENT NOMINAL · WALL STREET STILL WAITING · </div>
      </div>
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-5 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-3" aria-label="Arcaidia home">
          <ArcaidiaMark className="size-8 shrink-0" />
          <span className="font-display text-2xl uppercase text-newsprint">Arcaidia</span>
        </Link>
        {/* Desktop: inline nav. Mobile: a dedicated scrollable row below, so the
            wallet control never competes with the links for width. */}
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {ROUTES.map((r) => (
            <Link key={r.to} to={r.to} className={LINK_CLASS} activeProps={LINK_ACTIVE}>
              {r.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto shrink-0">
          <WalletControl />
        </div>
      </div>
      <nav
        aria-label="Main"
        className="flex items-center gap-1 overflow-x-auto border-t border-brass/60 bg-void px-2 py-1.5 md:hidden"
      >
        {ROUTES.map((r) => (
          <Link key={r.to} to={r.to} className={LINK_CLASS} activeProps={LINK_ACTIVE}>
            {r.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t-2 border-brass bg-void/90">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-8 text-sm text-text-dim sm:flex-row sm:items-center sm:px-6">
        <p className="font-mono uppercase">Arcaidia Signal Works — Circle CCTP speed division. Testnet.</p>
        <div className="flex gap-4 sm:ml-auto">
          <Link to="/about" className="hover:text-text">
            How it works
          </Link>
          <Link to="/docs" className="hover:text-text">
            Docs
          </Link>
          <a href="https://github.com" className="hover:text-text">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
