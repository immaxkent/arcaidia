import { useMemo, useState } from "react";
import { useWallet, useWalletBalance } from "@/components/wallet/wallet-context";
import { ARC_TESTNET, CHAINS, ETHEREUM_SEPOLIA, type Address } from "@/lib/arcaidia/types";
import {
  feeFromBps,
  formatBps,
  formatUsdc,
  isAddressLike,
  parseUsdc,
  truncateAddress,
} from "@/lib/arcaidia/format";
import { PROTOCOL_LIMITS, chainConfig } from "@/lib/arcaidia/config";
import { StateValue } from "@/components/data/state-views";
import { useIntent, useIntentQuote, type IntentRequest } from "@/hooks/arcaidia/use-intent";
import { cn } from "@/lib/utils";

const FEE_OPTIONS = [10, 30, 50, 100];
const DEADLINES = [
  { label: "30 minutes", value: 1800 },
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
];

/** The risk engine's own reason codes (e.g. "FEE_CEILING_EXCEEDED"), title-cased for display. */
function humaniseQuoteReason(reason: string): string {
  const words = reason.toLowerCase().split("_");
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * HANDOFF — the form itself is complete. The values it needs come from:
 *   USDC address       -> chainConfig(chainId).usdc
 *   balance            -> useWalletBalance (erc20 balanceOf)
 *   allowance          -> useUsdcAllowance against the IntentRouter
 *   fee / quote        -> useIntentQuote (solver quote or protocol fee config)
 *   submit             -> useIntent().createIntent -> Privy-signed createIntent
 *   intent id / tx     -> real receipt + IntentCreated event
 * Nothing below invents a quote, cap, ETA, intent id or transaction hash.
 */
export function TransferForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const { status, address, connect } = useWallet();
  const [source, setSource] = useState(ETHEREUM_SEPOLIA);
  const [swapping, setSwapping] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [maxFeeBps, setMaxFeeBps] = useState(PROTOCOL_LIMITS.defaultMaxFeeBps ?? 30);
  const [deadline, setDeadline] = useState(3600);
  const [advanced, setAdvanced] = useState(false);

  const destination = source === ETHEREUM_SEPOLIA ? ARC_TESTNET : ETHEREUM_SEPOLIA;
  const balanceState = useWalletBalance(source);
  const balance = balanceState.status === "ready" ? balanceState.data : null;
  const amount = parseUsdc(amountInput);
  const recipient = (recipientInput || address || "") as Address;
  const recipientValid = isAddressLike(recipient);
  const routerConfigured = chainConfig(source)?.intentRouter !== null;

  const request = useMemo<IntentRequest | null>(() => {
    if (!amount || amount === 0n || !recipientValid) return null;
    return {
      sourceChainId: source,
      destinationChainId: destination,
      amount,
      recipient,
      maxFeeBps,
      deadlineSeconds: deadline,
    };
  }, [amount, recipientValid, source, destination, recipient, maxFeeBps, deadline]);

  const quote = useIntentQuote(request);
  const { submitting, submitError, createIntent } = useIntent();

  const amountError = useMemo(() => {
    if (!amount) return null;
    if (PROTOCOL_LIMITS.maxIntentAmount !== null && amount > PROTOCOL_LIMITS.maxIntentAmount) {
      return "This amount is over the configured transfer cap.";
    }
    if (balance !== null && amount > balance) return "You don't have that much USDC on this chain.";
    return null;
  }, [amount, balance]);

  const maxPayable = amount ? feeFromBps(amount, maxFeeBps) : 0n;

  const buttonLabel =
    status !== "CONNECTED"
      ? "Connect wallet"
      : submitting
        ? "Submitting…"
        : !routerConfigured
          ? "Router not deployed yet"
          : "Confirm transfer";

  const disabled =
    status === "CONNECTED" &&
    (!amount || !!amountError || !recipientValid || submitting || !routerConfigured);

  function handlePrimary() {
    if (status !== "CONNECTED") return connect();
    if (!request) return;
    void createIntent(request).then(() => onSubmitted?.());
  }

  function swap() {
    setSwapping(true);
    setSource(destination);
    window.setTimeout(() => setSwapping(false), 250);
  }

  return (
    <div className="panel p-4 sm:p-5">
      <h2 className="text-base font-semibold text-text">Transfer USDC</h2>

      {/* Direction — one control, both directions. */}
      <div
        className={cn(
          "mt-4 flex items-stretch gap-2 transition-transform duration-[250ms]",
          swapping && "scale-[0.98]",
        )}
      >
        {[source, destination].map((id, index) => (
          <div key={`${id}-${index}`} className="panel-raised flex-1 px-3 py-3">
            <p className="text-xs tracking-wide text-text-dim uppercase">
              {index === 0 ? "From" : "To"}
            </p>
            <p className="mt-1 font-display text-base text-text">{CHAINS[id]?.short}</p>
            <p className="num mt-0.5 text-xs text-text-dim">{CHAINS[id]?.name}</p>
          </div>
        ))}
      </div>
      <div className="-mt-3 flex justify-center">
        <button
          type="button"
          onClick={swap}
          aria-label="Swap direction"
          className="panel-raised z-10 grid size-9 place-items-center text-electric-glow transition-transform duration-[250ms] hover:rotate-180"
        >
          ⇅
        </button>
      </div>

      {/* Amount */}
      <div className="panel-raised mt-2 px-3 py-3">
        <div className="flex items-center justify-between">
          <label htmlFor="amount" className="text-xs tracking-wide text-text-dim uppercase">
            Amount
          </label>
          <button
            type="button"
            disabled={balance === null}
            onClick={() =>
              balance !== null && setAmountInput(formatUsdc(balance).replace(/,/g, ""))
            }
            className="num rounded border border-electric/35 px-1.5 py-0.5 text-[0.7rem] text-electric-glow disabled:opacity-40"
          >
            MAX
          </button>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <input
            id="amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="num w-full bg-transparent text-2xl text-text outline-none placeholder:text-text-dim/50"
          />
          <span className="num text-sm text-text-dim">USDC</span>
        </div>
        <p className="num mt-1 text-xs text-text-dim">
          Balance <StateValue state={balanceState} format={(b) => `${formatUsdc(b)} USDC`} />
        </p>
      </div>

      {/* Recipient */}
      <div className="panel-raised mt-2 px-3 py-3">
        <label htmlFor="recipient" className="text-xs tracking-wide text-text-dim uppercase">
          Recipient on {CHAINS[destination]?.short}
        </label>
        <input
          id="recipient"
          value={recipientInput}
          placeholder={address ?? "0x…"}
          onChange={(e) => setRecipientInput(e.target.value)}
          className="num mt-1 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-dim/60"
        />
        {recipientInput.length > 0 ? (
          <p className={cn("num mt-1 text-xs", recipientValid ? "text-success" : "text-danger")}>
            {recipientValid ? truncateAddress(recipient) : "Enter a valid 0x address"}
          </p>
        ) : (
          <p className="mt-1 text-xs text-text-dim">
            Leave blank to send to your own address on {CHAINS[destination]?.short}.
          </p>
        )}
      </div>

      {/* Max fee */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-text">Most you&apos;ll pay</span>
          <span className="num text-sm text-text-dim" title={`${maxFeeBps} bps`}>
            {formatBps(maxFeeBps)}
            {amount ? ` · up to ${formatUsdc(maxPayable)} USDC` : ""}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {FEE_OPTIONS.map((bps) => (
            <button
              key={bps}
              type="button"
              onClick={() => setMaxFeeBps(bps)}
              title={`${bps} bps`}
              className={cn(
                "num rounded-md border py-1.5 text-xs transition-colors",
                bps === maxFeeBps
                  ? "border-electric/60 bg-electric/15 text-electric-glow"
                  : "border-border text-text-dim hover:text-text",
              )}
            >
              {formatBps(bps)}
            </button>
          ))}
        </div>
      </div>

      {/* Advanced */}
      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        aria-expanded={advanced}
        className="mt-4 text-xs text-text-dim hover:text-text"
      >
        Advanced {advanced ? "−" : "+"}
      </button>
      {advanced ? (
        <div className="panel-raised mt-2 flex items-center justify-between px-3 py-2.5">
          <label htmlFor="deadline" className="text-sm text-text-dim">
            Deadline
          </label>
          <select
            id="deadline"
            value={deadline}
            onChange={(e) => setDeadline(Number(e.target.value))}
            className="num bg-transparent text-sm text-text outline-none"
          >
            {DEADLINES.map((d) => (
              <option key={d.value} value={d.value} className="bg-surface-raised">
                {d.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* Quote preview — only ever shows a real solver quote (WP-14). */}
      <div className="mt-4 border-t border-border pt-4">
        {!amount ? (
          <p className="text-sm text-text-dim">Enter an amount to request a quote.</p>
        ) : amountError ? (
          <p className="text-sm text-danger">{amountError}</p>
        ) : quote.status === "ready" && quote.data.verdict !== "ACCEPT" ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
            <p className="text-sm text-warning">{humaniseQuoteReason(quote.data.reason)}</p>
            <span className="num shrink-0 text-[10px] uppercase tracking-wide text-text-dim/70">
              Estimated
            </span>
          </div>
        ) : (
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-text-dim">You send</dt>
              <dd className="num text-text">{formatUsdc(amount)} USDC</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-dim">Recipient gets</dt>
              <dd className="num text-text">
                <StateValue state={quote} format={(q) => `${formatUsdc(q.outputAmount)} USDC`} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-dim">Fee</dt>
              <dd className="num text-text">
                <StateValue
                  state={quote}
                  format={(q) => `${formatUsdc(q.feeAmount)} USDC · ${formatBps(q.feeBps)}`}
                />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-dim">Estimated arrival</dt>
              <dd className="num text-electric-glow">
                <StateValue state={quote} format={() => "—"} />
              </dd>
            </div>
            {quote.status === "ready" ? (
              <p className="num pt-1 text-right text-[10px] uppercase tracking-wide text-text-dim/70">
                Estimated · final terms set when your transfer confirms
              </p>
            ) : null}
          </dl>
        )}
        {quote.status === "unavailable" && amount && !amountError ? (
          <p className="num mt-2 text-[11px] uppercase tracking-wide text-text-dim/70">
            Quote source not connected yet — no fee is estimated
          </p>
        ) : null}
        {quote.status === "error" && amount && !amountError ? (
          <p className="num mt-2 text-[11px] uppercase tracking-wide text-danger/80">
            Quote request failed — no fee is estimated
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={handlePrimary}
        disabled={disabled}
        className={cn(
          "mt-4 w-full rounded-lg bg-electric py-3 text-sm font-semibold text-primary-foreground transition-opacity glow-electric",
          disabled && "opacity-45",
        )}
      >
        {buttonLabel}
      </button>
      {submitError ? <p className="mt-2 text-center text-xs text-warning">{submitError}</p> : null}
    </div>
  );
}
