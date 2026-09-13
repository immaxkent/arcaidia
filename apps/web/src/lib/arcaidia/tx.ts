/**
 * Wallet-transaction ergonomics shared by every owner/user-signed flow (Transfer, Earn).
 *
 * Two lessons from the first live vault creation (2026-09-13):
 *  - a public RPC rate-limited the *receipt* lookup after the transaction had already landed,
 *    and the page reported failure for a vault that existed — receipts are fetched with backoff
 *    and callers recover from chain state (a predicted CREATE2 address, a deployed-code check)
 *    rather than trusting one RPC round-trip;
 *  - raw viem/provider errors are paragraphs; users get one short, actionable line, and the
 *    wallet is moved to the right network *before* a transaction is attempted.
 */
import type { PublicClient, TransactionReceipt } from "viem";
import { toast } from "sonner";
import { CHAINS } from "./types";

export interface TxErrorDescription {
  /** ≤ 60 chars, what happened. */
  readonly title: string;
  /** ≤ 160 chars, what to do about it — or the provider's own short message. */
  readonly detail: string;
  readonly kind: "rejected" | "wrong-chain" | "rate-limit" | "insufficient-funds" | "other";
}

function messageOf(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { shortMessage?: unknown; message?: unknown; details?: unknown };
    for (const candidate of [e.shortMessage, e.details, e.message]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return typeof error === "string" ? error : "Transaction failed.";
}

function firstLine(text: string, max = 160): string {
  const line = text.split("\n").find((l) => l.trim()) ?? text;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function describeTxError(error: unknown, expectedChainId?: number): TxErrorDescription {
  const message = messageOf(error);
  const lower = message.toLowerCase();
  const code = (error as { code?: unknown })?.code;

  if (code === 4001 || /user rejected|user denied|rejected the request/.test(lower)) {
    return { kind: "rejected", title: "Signature declined", detail: "Nothing was sent. Try again when ready." };
  }
  if (/chain id|chainid|does not match|wrong network|switch chain|unsupported chain/.test(lower)) {
    const name = expectedChainId ? (CHAINS[expectedChainId]?.name ?? `chain ${expectedChainId}`) : "the selected chain";
    return {
      kind: "wrong-chain",
      title: "Wallet is on the wrong network",
      detail: `Switch your wallet to ${name} and try again.`,
    };
  }
  if (/rate limit|exceeds defined limit|too many requests|429/.test(lower)) {
    return {
      kind: "rate-limit",
      title: "RPC rate limit hit",
      detail: "The transaction may still have gone through — checking the chain before retrying.",
    };
  }
  if (/insufficient funds|insufficient balance|exceeds the balance/.test(lower)) {
    return { kind: "insufficient-funds", title: "Not enough funds for gas", detail: firstLine(message) };
  }
  return { kind: "other", title: "Transaction failed", detail: firstLine(message) };
}

/** Toast it, and hand back the one-liner for an inline caption. */
export function reportTxError(error: unknown, expectedChainId?: number): string {
  const described = describeTxError(error, expectedChainId);
  toast.error(described.title, { description: described.detail });
  return `${described.title} — ${described.detail}`;
}

/** Move the wallet to `chainId` before signing there, rather than letting the provider reject. */
export async function ensureWalletChain(
  wallet: { chainId: number; switchChain: (chainId: number) => Promise<void> },
  chainId: number,
): Promise<void> {
  if (wallet.chainId !== chainId) await wallet.switchChain(chainId);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `getTransactionReceipt` with exponential backoff on *errors* (a rate-limited RPC throws;
 * a merely unmined transaction returns null and keeps polling) up to `timeoutMs`. Returns
 * `null` on timeout so the caller can fall back to a chain-state check instead of failing.
 */
export async function waitForReceiptResilient(
  client: Pick<PublicClient, "getTransactionReceipt">,
  hash: `0x${string}`,
  options: { timeoutMs?: number; initialDelayMs?: number; maxDelayMs?: number; sleepFn?: typeof sleep } = {},
): Promise<TransactionReceipt | null> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxDelay = options.maxDelayMs ?? 15_000;
  const wait = options.sleepFn ?? sleep;
  let delay = options.initialDelayMs ?? 2_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt) return receipt;
      await wait(delay);
    } catch {
      await wait(delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  }
  return null;
}

/** Poll until `address` has code (a CREATE2 deployment landed), with the same backoff. */
export async function waitForCode(
  client: Pick<PublicClient, "getCode">,
  address: `0x${string}`,
  options: { timeoutMs?: number; delayMs?: number; sleepFn?: typeof sleep } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const wait = options.sleepFn ?? sleep;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const code = await client.getCode({ address });
      if (code && code !== "0x") return true;
    } catch {
      /* rate-limited — keep polling */
    }
    await wait(options.delayMs ?? 5_000);
  }
  return false;
}
