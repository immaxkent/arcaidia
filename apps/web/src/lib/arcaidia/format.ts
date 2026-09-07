import type { Address, Hex } from "./types";

const USDC_DECIMALS = 1_000_000n;

/** Format a 6-decimal bigint amount with thousands separators and exactly 2 decimals. */
export function formatUsdc(amount: bigint): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / USDC_DECIMALS;
  const frac = abs % USDC_DECIMALS;
  const cents = (frac / 10_000n).toString().padStart(2, "0");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeStr}.${cents}`;
}

export function formatUsdcWithSymbol(amount: bigint): string {
  return `${formatUsdc(amount)} USDC`;
}

/** Parse a user-typed decimal string into a 6-decimal bigint. */
export function parseUsdc(input: string): bigint | null {
  const cleaned = input.replace(/,/g, "").trim();
  if (!cleaned) return null;
  if (!/^\d*(\.\d{0,6})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const padded = (frac + "000000").slice(0, 6);
  return BigInt(whole || "0") * USDC_DECIMALS + BigInt(padded || "0");
}

/** 30 bps -> "0.30%" */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Fee in USDC implied by bps against an amount. */
export function feeFromBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(Math.round(bps))) / 10_000n;
}

export function truncateAddress(value: Address | Hex, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function isAddressLike(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function relativeTime(unixSeconds: number, now = Date.now() / 1000): string {
  const delta = Math.max(0, Math.round(now - unixSeconds));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function absoluteTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function clockTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(11, 19);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** LP assets = totalBalance + outstandingExposure − accruedProtocolFees. */
export function lpAssets(v: {
  totalBalance: bigint;
  outstandingExposure: bigint;
  accruedProtocolFees: bigint;
}): bigint {
  return v.totalBalance + v.outstandingExposure - v.accruedProtocolFees;
}
