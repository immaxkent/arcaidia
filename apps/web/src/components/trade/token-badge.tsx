import type React from "react";
/**
 * WP-34 — cartoon token badges for the market's four mock assets. Drawn inline (no external
 * assets, no copyrighted marks): a flat coloured coin with a bold outline and a simple glyph
 * that reads at 20 px. Unknown symbols get a neutral coin with their first letter.
 */
const COIN: Record<string, { fill: string; ink: string; glyph: (ink: string) => React.ReactNode }> = {
  mETH: {
    fill: "#8aa8ff",
    ink: "#1b2a5b",
    glyph: (ink) => (
      <g fill="none" stroke={ink} strokeWidth="2.2" strokeLinejoin="round">
        <path d="M16 6 L24 17 L16 22 L8 17 Z" fill="#dfe8ff" />
        <path d="M8 17 L16 26 L24 17" />
      </g>
    ),
  },
  mAAVE: {
    fill: "#c2a2ff",
    ink: "#3a1e6b",
    glyph: (ink) => (
      <g fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round">
        <path d="M9 24 Q16 6 23 24" />
        <path d="M11 19 H21" />
      </g>
    ),
  },
  mGRT: {
    fill: "#8ee3d8",
    ink: "#0f4a44",
    glyph: (ink) => (
      <g fill={ink}>
        <circle cx="12" cy="13" r="4.2" />
        <circle cx="21" cy="19" r="2.8" />
        <rect x="14.5" y="15" width="6" height="2.2" transform="rotate(35 17.5 16)" />
      </g>
    ),
  },
  mPEPE: {
    fill: "#8fe388",
    ink: "#1e4d1a",
    glyph: (ink) => (
      <g>
        <circle cx="11.5" cy="12" r="3.6" fill="#fff" stroke={ink} strokeWidth="1.6" />
        <circle cx="20.5" cy="12" r="3.6" fill="#fff" stroke={ink} strokeWidth="1.6" />
        <circle cx="12.5" cy="12.5" r="1.4" fill={ink} />
        <circle cx="21.5" cy="12.5" r="1.4" fill={ink} />
        <path d="M9 20 Q16 25 23 20" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      </g>
    ),
  },
};

export function TokenBadge({ symbol, size = 24, className }: { symbol: string; size?: number; className?: string }) {
  const coin = COIN[symbol];
  const fill = coin?.fill ?? "#c9cdd6";
  const ink = coin?.ink ?? "#2b2f38";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={symbol} className={className}>
      <circle cx="16" cy="16" r="14.5" fill={fill} stroke={ink} strokeWidth="2.4" />
      <circle cx="12" cy="10" r="3" fill="#ffffff" opacity="0.45" />
      {coin ? coin.glyph(ink) : <text x="16" y="21" textAnchor="middle" fontSize="15" fontWeight="700" fill={ink}>{symbol.replace(/^m/, "").charAt(0)}</text>}
    </svg>
  );
}
