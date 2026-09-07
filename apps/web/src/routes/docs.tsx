import { createFileRoute } from "@tanstack/react-router";
import { CopyValue } from "@/components/site/copy-value";
import { CHAIN_CONFIG, SUPPORTED_CHAIN_IDS } from "@/lib/arcaidia/config";
import { CHAINS } from "@/lib/arcaidia/types";
import { NOT_AVAILABLE } from "@/lib/arcaidia/data-state";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation — Arcaidia architecture and trust assumptions" },
      {
        name: "description",
        content:
          "Arcaidia architecture, the authorised-solver trust assumption, contract addresses, fees and FAQ for crosschain USDC between Ethereum and Arc.",
      },
      { property: "og:title", content: "Arcaidia documentation" },
      {
        property: "og:description",
        content: "Architecture, disclosed trust assumptions, contract addresses, fees and FAQ.",
      },
    ],
  }),
  component: DocsPage,
});

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How it works" },
  { id: "trust", label: "The trust assumption" },
  { id: "contracts", label: "Contract addresses" },
  { id: "fees", label: "Fees" },
  { id: "faq", label: "FAQ" },
  { id: "links", label: "Links" },
];

function DocsPage() {
  return (
    <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[14rem_1fr]">
      <nav aria-label="On this page" className="lg:sticky lg:top-20 lg:self-start">
        <p className="text-xs tracking-wide text-text-dim uppercase">On this page</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-text-dim hover:text-text">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="measure space-y-12 text-[0.95rem] leading-7 text-text-dim">
        <section id="overview">
          <h1 className="text-3xl font-bold text-text">Documentation</h1>
          <p className="mt-4">
            Arcaidia is a speed layer over Circle&apos;s CCTP. Your money goes into Circle&apos;s pipe first; an
            autonomous agent verifies that independently, prices the wait, and advances you the destination funds
            from a liquidity vault in seconds. CCTP repays the vault minutes later.
          </p>
        </section>

        <section id="how-it-works">
          <h2 className="text-xl font-semibold text-text">How it works</h2>
          <p className="mt-3">
            A transfer produces two independent settlement facts. The fast fact is the advance from the destination
            vault to the recipient. The canonical fact is CCTP&apos;s own settlement, which reimburses the vault.
            They are tracked separately everywhere in this app, because they complete at different times.
          </p>
          <p className="mt-3">
            If no solver participates, CCTP pays the recipient directly. Arcaidia accelerates; it is never
            required.
          </p>
        </section>

        <section id="trust">
          <h2 className="text-xl font-semibold text-text">The trust assumption</h2>
          <p className="mt-3">
            Arcaidia uses an authorised-solver model. The destination vault trusts EIP-712 signatures from
            allowlisted agent addresses after the agent has independently verified the source chain. This is a
            disclosed trust assumption, not a claim of trustless crosschain verification.
          </p>
        </section>

        <section id="contracts">
          <h2 className="text-xl font-semibold text-text">Contract addresses</h2>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-text-dim uppercase">
                <th className="pb-2 font-medium">Chain</th>
                <th className="pb-2 font-medium">Contract</th>
                <th className="pb-2 font-medium">Address</th>
              </tr>
            </thead>
            <tbody>
              {/* HANDOFF: addresses come from src/lib/arcaidia/config.ts (env-driven). */}
              {SUPPORTED_CHAIN_IDS.flatMap((chainId) =>
                (
                  [
                    ["IntentRouter", CHAIN_CONFIG[chainId]?.intentRouter ?? null],
                    ["ArcaidiaHouseVault", CHAIN_CONFIG[chainId]?.houseVault ?? null],
                    ["SolverVaultFactory", CHAIN_CONFIG[chainId]?.vaultFactory ?? null],
                    ["USDC", CHAIN_CONFIG[chainId]?.usdc ?? null],
                  ] as const
                ).map(([name, addr]) => (
                  <tr key={`${chainId}-${name}`} className="border-t border-border/60">
                    <td className="py-2.5">{CHAINS[chainId]?.name}</td>
                    <td className="py-2.5 text-text">{name}</td>
                    <td className="py-2.5">
                      {addr ? (
                        <CopyValue value={addr} label="contract address" />
                      ) : (
                        <span className="num text-text-dim/70" title="Not deployed / not configured yet">
                          {NOT_AVAILABLE}
                        </span>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </section>

        <section id="fees">
          <h2 className="text-xl font-semibold text-text">Fees</h2>
          <p className="mt-3">
            You set a ceiling in basis points (0.10% / 0.30% / 0.50% / 1.00%). The solver quotes a fee at or below
            that ceiling based on free liquidity, outstanding exposure and settlement health. If the quote would
            exceed your ceiling, the transfer simply settles at CCTP&apos;s speed instead.
          </p>
          <p className="mt-3">
            The fee compensates the liquidity provider for the minutes their capital is advanced. A separate
            protocol fee accrues in the vault and is owed to the treasury — it is never part of an LP&apos;s
            position.
          </p>
        </section>

        <section id="faq">
          <h2 className="text-xl font-semibold text-text">FAQ</h2>
          <dl className="mt-4 space-y-5">
            {[
              [
                "Can I cancel after signing?",
                "No. The funds are handed to CCTP in the same transaction that records your intent. If that handoff fails, everything reverts and you keep your money.",
              ],
              [
                "What if the solver never quotes?",
                "The canonical CCTP transfer pays the recipient directly, minutes later. This is a normal outcome, not a failure.",
              ],
              [
                "Why is my LP position larger than what I can withdraw?",
                "Some of your capital is advanced to a recipient and returns when CCTP settles. Available now and Your position differ for exactly that reason.",
              ],
              [
                "Which chains are supported?",
                "Ethereum Sepolia (11155111) and Arc Testnet (5042002), in both directions.",
              ],
            ].map(([q, a]) => (
              <div key={q}>
                <dt className="font-medium text-text">{q}</dt>
                <dd className="mt-1">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="links">
          <h2 className="text-xl font-semibold text-text">Links</h2>
          <ul className="mt-3 space-y-1.5">
            <li>
              <a href="https://github.com" className="text-electric-glow hover:underline">
                GitHub
              </a>
            </li>
            <li>
              <a href="https://thegraph.com" className="text-electric-glow hover:underline">
                Subgraphs
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
