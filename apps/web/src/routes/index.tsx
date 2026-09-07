import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, ArrowRight, Gauge, Radio, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Arcaidia — USDC across chains in seconds, settled by CCTP" },
      {
        name: "description",
        content:
          "Arcaidia is a speed layer over Circle's CCTP. An autonomous solver verifies your transfer and advances the destination funds in seconds; CCTP repays the vault minutes later.",
      },
      { property: "og:title", content: "Arcaidia — a speed layer over Circle's CCTP" },
      {
        property: "og:description",
        content: "Crosschain USDC between Ethereum and Arc. Paid in seconds, settled canonically in minutes.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="overflow-hidden">
      <section className="mx-auto flex min-h-[calc(100svh-5.25rem)] max-w-[1500px] items-center px-3 py-8 sm:px-6 lg:py-10">
        <div className="control-console w-full">
          <div className="console-rivets" aria-hidden>{[0,1,2,3,4,5].map((n) => <i key={n} />)}</div>
          <div className="grid gap-4 p-3 sm:p-5 lg:grid-cols-[220px_minmax(0,1fr)_220px] lg:gap-5">
            <aside className="order-2 grid grid-cols-2 gap-3 lg:order-1 lg:flex lg:flex-col" aria-label="Protocol status">
              {/* HANDOFF: wire to useMarketIntelligence(); no value is invented meanwhile. */}
              <Status label="Liquidity pressure" value="--" tone="pink" width="0%" />
              <Status label="Public patience" value="--" tone="acid" width="0%" />
              <div className="instrument col-span-2 flex min-h-40 flex-col items-center justify-center lg:flex-1">
                <Gauge className="size-14 text-pink drop-shadow-neon-pink" strokeWidth={1.5} />
                <span className="mt-3 font-display text-xl uppercase text-newsprint">Risk pressure</span>
                <span className="font-mono text-[10px] uppercase text-pink">Awaiting market feed</span>
              </div>
            </aside>

            <div className="crt-screen order-1 flex min-h-[500px] flex-col justify-center px-5 py-10 text-center lg:order-2">
              <div className="absolute left-4 top-4 flex items-center gap-2 font-mono text-[10px] uppercase text-acid"><Radio className="size-3 animate-pulse" /> Live / District 01</div>
              <p className="font-mono text-[11px] uppercase text-acid">Ethereum ⇄ Arc · USDC Signal Works</p>
              <h1 className="neon-title mt-5 text-[clamp(4.6rem,10vw,9.5rem)] leading-[0.78] text-newsprint">Arcaidia</h1>
              <p className="mx-auto mt-7 max-w-xl font-display text-2xl uppercase text-pink sm:text-3xl">Your money arrives before the bureaucracy does.</p>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-text-dim sm:text-base">The autonomous solver verifies your transfer, prices the wait, and advances USDC in seconds. Circle settles the official paperwork minutes later.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button asChild size="lg" className="control-button h-12 border-2 border-acid bg-acid px-6 font-display text-xl uppercase text-void hover:bg-newsprint">
                  <Link to="/transfer"><Zap /> Start transfer</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="control-button h-12 border-2 border-pink bg-pink/10 px-6 font-display text-xl uppercase text-pink hover:bg-pink hover:text-void">
                  <Link to="/about">Open the files <ArrowRight /></Link>
                </Button>
              </div>
              <div className="mt-8 flex items-center justify-center gap-3 font-mono text-[10px] uppercase text-text-dim"><span className="size-2 bg-acid shadow-neon-acid" /> Awaiting protocol connection · no synthetic data shown</div>
            </div>

            <aside className="order-3 grid grid-cols-2 gap-3 lg:flex lg:flex-col" aria-label="System log">
              <div className="instrument col-span-2 flex-1 p-4 text-left">
                <div className="flex items-center justify-between border-b border-brass pb-3"><span className="font-mono text-[10px] uppercase text-acid">System log</span><Activity className="size-4 text-acid" /></div>
                <ul className="mt-4 space-y-4 font-mono text-[10px] uppercase text-text-dim">
                  {/* HANDOFF: replace with real protocol events once the indexer is wired. */}
                  <li><b className="text-pink">›</b> AWAITING PROTOCOL FEED</li>
                  <li><b className="text-acid">›</b> NO EVENTS INDEXED YET</li>
                  <li><b className="text-pink">›</b> VAULT STATUS UNAVAILABLE</li>
                  <li><b className="text-acid">›</b> TELEMETRY UNAVAILABLE</li>
                </ul>
              </div>
              <Track label="Fast path" value="design target: seconds" tone="electric" />
              <Track label="Canonical" value="design target: minutes" tone="gold" />
            </aside>
          </div>
          <div className="console-footer"><span>AUTHORIZED OPERATORS ONLY</span><span className="hidden sm:inline">THE FUTURE IS AUDITED</span><span>DISTRICT 01</span></div>
        </div>
      </section>

      <section className="mx-auto max-w-[1500px] px-4 pb-20 sm:px-6">
        <div className="flex items-end justify-between border-b-2 border-acid pb-3"><div><p className="font-mono text-xs uppercase text-pink">Official communiqué 03</p><h2 className="mt-1 text-4xl uppercase text-newsprint sm:text-5xl">How the signal moves</h2></div><span className="hidden font-mono text-xs text-acid sm:block">APPROVED FOR PUBLIC CONSUMPTION</span></div>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {[
            {
              n: "01", t: "You commit once",
              b: "One signature hands your USDC to CCTP through Arcaidia's router. If the handoff fails, everything reverts and you keep your money.",
              tone: "text-acid",
            },
            {
              n: "02", t: "An agent prices the wait",
              b: "It re-reads your transaction from an Ethereum node, checks free liquidity and settlement health, then returns a fee and a verdict. Deterministic — no AI in the decision.",
              tone: "text-pink",
            },
            {
              n: "03", t: "The vault is repaid",
              b: "You were paid seconds in. Minutes later CCTP settles and reimburses the liquidity provider, who keeps the fee for the minutes of risk.",
              tone: "text-gold",
            },
          ].map((c) => (
            <article key={c.t} className="propaganda-panel p-5">
              <span className={`font-display text-5xl ${c.tone}`}>{c.n}</span>
              <h3 className="mt-4 text-2xl uppercase text-newsprint">{c.t}</h3>
              <p className="mt-2 text-sm leading-6 text-text-dim">{c.b}</p>
            </article>
          ))}
        </div>
        <p className="mt-8 text-sm text-text-dim">
          If no solver participates, the transfer still completes at CCTP&apos;s own speed.{" "}
          <Link to="/about" className="text-electric-glow hover:underline">
            Read the ten-stage walkthrough
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function Status({ label, value, tone, width }: { label: string; value: string; tone: "pink" | "acid"; width: string }) {
  return <div className="instrument p-3"><div className="flex justify-between font-mono text-[10px] uppercase"><span className={tone === "pink" ? "text-pink" : "text-acid"}>{label}</span><span className="text-newsprint">{value}</span></div><div className="mt-3 h-2 border border-brass bg-void"><div className={tone === "pink" ? "h-full bg-pink shadow-neon-pink" : "h-full bg-acid shadow-neon-acid"} style={{ width }} /></div></div>;
}

function Track({ label, value, tone }: { label: string; value: string; tone: "electric" | "gold" }) {
  return <div className="instrument p-3"><span className={`block size-3 ${tone === "electric" ? "bg-electric glow-electric" : "bg-gold glow-gold"}`} /><span className="mt-3 block font-mono text-[9px] uppercase text-text-dim">{label}</span><strong className={`font-display text-xl uppercase ${tone === "electric" ? "text-electric-glow" : "text-gold-glow"}`}>{value}</strong></div>;
}
