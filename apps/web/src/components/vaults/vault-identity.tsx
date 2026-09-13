/**
 * A vault's visual signature: two hues, a grid, a slow shimmer — derived from its name, so the
 * same vault on both chains looks the same and every new deployment gets its own look the
 * moment it is named. Nothing is stored; the hash *is* the identity. Colour never carries
 * meaning here (state has its own chips), it only makes a vault recognisable at a glance.
 */
import type { CSSProperties } from "react";
import { truncateAddress } from "@/lib/arcaidia/format";

export interface VaultSignature {
  readonly hue: number;
  readonly hue2: number;
  readonly style: CSSProperties;
}

/** FNV-1a over the name (or the address when a vault has none) — stable, cheap, well spread. */
export function vaultSignature(label: string | null | undefined, address: string): VaultSignature {
  const seed = (label ?? "").trim().toLowerCase() || address.toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Golden-angle spread: neighbouring hashes land far apart on the wheel, so a handful of
  // vaults never share a colour family by accident (plain `h % 360` put two of the first three
  // within 20° of each other).
  const hue = Math.round(((h % 4096) * 137.508) % 360);
  const hue2 = (hue + 150 + ((h >>> 12) % 60)) % 360;
  const angle = (h >>> 17) % 360;
  const seconds = 7 + ((h >>> 22) % 8);
  return {
    hue,
    hue2,
    style: {
      ["--sig-h1" as string]: String(hue),
      ["--sig-h2" as string]: String(hue2),
      ["--sig-angle" as string]: `${angle}deg`,
      ["--sig-dur" as string]: `${seconds}s`,
    },
  };
}

/** The vault's name on its signature, as a pill. */
export function VaultName({
  label,
  address,
  className = "",
  size = "sm",
}: {
  label: string | null | undefined;
  address: string;
  className?: string;
  size?: "sm" | "lg";
}) {
  const sig = vaultSignature(label, address);
  const text = label ?? truncateAddress(address as `0x${string}`);
  return (
    <span
      className={`vault-sigil inline-flex items-center rounded-md border px-2.5 ${size === "lg" ? "py-1 text-xl" : "py-0.5 text-[inherit]"} font-semibold uppercase tracking-wide text-newsprint ${className}`}
      style={sig.style}
      title={address}
    >
      <span className="relative">{text}</span>
    </span>
  );
}

/** A thin signature bar — for a card edge or a table cell — with no text of its own. */
export function VaultSigilBar({ label, address, className = "" }: { label: string | null | undefined; address: string; className?: string }) {
  return <span aria-hidden="true" className={`vault-sigil block h-1.5 rounded-full border-0 ${className}`} style={vaultSignature(label, address).style} />;
}
