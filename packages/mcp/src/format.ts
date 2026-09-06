/**
 * Turning protocol state into answers.
 *
 * An MCP tool is read by a language model and, through it, by a person. Handing
 * back `99001000000n` is technically the truth and practically useless: the
 * model has to guess the decimals, and it will sometimes guess wrong in a
 * sentence that sounds confident. Formatting here — once, correctly — is the
 * difference between a tool that informs and one that misleads fluently.
 */

const USDC_DECIMALS = 6n;
const SCALE = 10n ** USDC_DECIMALS;

/** `99001000000n` → `"99,001.00"`. Exact: no float arithmetic anywhere. */
export function formatUsdc(amount: bigint): string {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;

  const whole = value / SCALE;
  const fraction = value % SCALE;

  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fractionText = fraction.toString().padStart(Number(USDC_DECIMALS), '0').slice(0, 2);

  return `${negative ? '-' : ''}${wholeText}.${fractionText}`;
}

/** With the unit attached, for prose. */
export const usdc = (amount: bigint): string => `${formatUsdc(amount)} USDC`;

/** `2500` → `"25.00%"`. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** `4500` → `"1h 15m"`. Null stays null rather than becoming a misleading zero. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** `0x1234…9f2a`, for readable prose about addresses. */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}
