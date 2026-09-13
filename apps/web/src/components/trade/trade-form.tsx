import { useEffect, useMemo, useState } from "react";
import { parseUnits as viemParseUnits } from "viem";
import { formatUnits } from "viem";
import { useWallet, useWalletBalance } from "@/components/wallet/wallet-context";
import { ARC_TESTNET, CHAINS, ETHEREUM_SEPOLIA, type Address, type AgentDecision } from "@/lib/arcaidia/types";
import { feeFromBps, formatBps, formatUsdc, isAddressLike, parseUsdc, truncateAddress } from "@/lib/arcaidia/format";
import { PROTOCOL_LIMITS, chainConfig } from "@/lib/arcaidia/config";
import { SWAP_INFRASTRUCTURE, type DestinationMarket } from "@arcaidia/domain";
import { StateValue } from "@/components/data/state-views";
import { useIntent, useIntentQuote, type IntentRequest } from "@/hooks/arcaidia/use-intent";
import { targetMinOutFrom, useSwapQuote } from "@/hooks/arcaidia/use-swap-quote";
import type { MarketsResponse } from "@/hooks/arcaidia/use-market-prices";
import { cn } from "@/lib/utils";
import { TokenPicker } from "./token-picker";

const FEE_OPTIONS = [10, 30, 50, 100];
const SLIPPAGE_OPTIONS = [50, 100, 200, 500];

export function marketsOn(chainId: number): readonly DestinationMarket[] {
  const key = chainId === ETHEREUM_SEPOLIA ? "ethereum-sepolia" : "arc-testnet";
  return SWAP_INFRASTRUCTURE[key]?.markets ?? [];
}

/**
 * A floor as text for the input: six significant digits, rounded *down* so the number the user
 * sees (and that gets parsed back into the intent) is never above the suggested floor.
 */
export function floorInputText(amount: bigint, decimals: number): string {
  if (amount <= 0n) return "0";
  const digits = amount.toString();
  const keep = 6;
  const truncated = digits.length > keep ? digits.slice(0, keep) + "0".repeat(digits.length - keep) : digits;
  return formatUnits(BigInt(truncated), decimals);
}

/** Token units → a readable amount; 6 significant digits like the price API's `display`. */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  const n = Number(formatUnits(amount, decimals));
  if (!Number.isFinite(n)) return formatUnits(amount, decimals);
  return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toPrecision(6).replace(/\.?0+$/, "");
}

function humaniseQuoteReason(reason: string): string {
  return reason.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * WP-34 — the Trade form. Same router call as a transfer, two more fields: `tokenOut` (the
 * market token on the destination chain) and `targetMinOut` (the floor). The floor is derived
 * from the destination adapter's own quote for the solver's quoted output, less the user's
 * slippage tolerance — never from the chart, which is a minute old and carries neither the
 * fast-fill fee nor this trade's own price impact.
 */
export function TradeForm({
  source,
  onSource,
  symbol,
  onSymbol,
  markets,
  onQuoteChange,
  onSubmitted,
}: {
  source: number;
  onSource: (chainId: number) => void;
  symbol: string | null;
  onSymbol: (symbol: string) => void;
  markets: MarketsResponse | null;
  onQuoteChange?: (decision: AgentDecision | null) => void;
  onSubmitted?: () => void;
}) {
  const { status, address, connect } = useWallet();
  const [amountInput, setAmountInput] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [maxFeeBps, setMaxFeeBps] = useState(PROTOCOL_LIMITS.defaultMaxFeeBps ?? 30);
  const [slippageBps, setSlippageBps] = useState(100);
  const [deadline] = useState(3600);

  const destination = source === ETHEREUM_SEPOLIA ? ARC_TESTNET : ETHEREUM_SEPOLIA;
  const destinationMarkets = marketsOn(destination);
  const market = destinationMarkets.find((m) => m.tokenOut.symbol === symbol) ?? null;
  const balanceState = useWalletBalance(source);
  const balance = balanceState.status === "ready" ? balanceState.data : null;
  const amount = parseUsdc(amountInput);
  const recipient = (recipientInput || address || "") as Address;
  const recipientValid = isAddressLike(recipient);
  const routerConfigured = chainConfig(source)?.intentRouter !== null;

  // The solver's quote for the USDC leg (fee, output USDC) — a plain transfer quote, the same number
  // the vault will hand the adapter.
  const usdcRequest = useMemo<IntentRequest | null>(() => {
    if (!amount || amount === 0n || !recipientValid) return null;
    return { sourceChainId: source, destinationChainId: destination, amount, recipient, maxFeeBps, deadlineSeconds: deadline };
  }, [amount, recipientValid, source, destination, recipient, maxFeeBps, deadline]);
  const quote = useIntentQuote(usdcRequest);
  const quotedUsdcOut = quote.status === "ready" && quote.data.verdict === "ACCEPT" ? quote.data.outputAmount : null;
  // What the vault would hand the adapter: the solver's accepted output when there is one, else the
  // amount less the vault's posted tier (or the widest tier today, 15 bps) — so the token quote and
  // the floor exist even while the solver declines this size or has not answered yet.
  const assumedFeeBps = quote.status === "ready" ? quote.data.inputsUsed.vaultFeeBps : 15;
  const swapAmountIn = quotedUsdcOut ?? (amount && amount > 0n ? amount - (amount * BigInt(assumedFeeBps) + 9_999n) / 10_000n : null);
  const quoteIsEstimate = quotedUsdcOut === null;

  // The adapter's quote for that USDC → tokenOut, on the destination chain.
  const swap = useSwapQuote(destination, (market?.tokenOut.address as Address | undefined) ?? null, swapAmountIn);
  const suggestedFloor = swap.status === "ready" ? targetMinOutFrom(swap.data.amountOut, slippageBps) : null;

  // The floor the intent carries: prefilled from the quote less slippage, but the user's own number
  // once they type one (a fresh token or amount resets it).
  const [floorInput, setFloorInput] = useState("");
  const [floorTouched, setFloorTouched] = useState(false);
  useEffect(() => {
    setFloorTouched(false);
    setFloorInput("");
  }, [symbol, destination]);
  useEffect(() => {
    if (floorTouched || suggestedFloor === null || !market) return;
    setFloorInput(floorInputText(suggestedFloor, market.tokenOut.decimals));
  }, [suggestedFloor, floorTouched, market]);
  const targetMinOut = useMemo<bigint | null>(() => {
    if (!market) return null;
    const trimmed = floorInput.trim();
    if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
    try {
      return viemParseUnits(trimmed, market.tokenOut.decimals);
    } catch {
      return null;
    }
  }, [floorInput, market]);

  const request = useMemo<IntentRequest | null>(() => {
    if (!usdcRequest || !market || targetMinOut === null || targetMinOut <= 0n) return null;
    return { ...usdcRequest, tokenOut: market.tokenOut.address as Address, targetMinOut };
  }, [usdcRequest, market, targetMinOut]);

  const { submitting, submitError, createIntent } = useIntent();
  useEffect(() => {
    onQuoteChange?.(quote.status === "ready" ? quote.data : null);
  }, [quote, onQuoteChange]);

  const amountError = useMemo(() => {
    if (!amount) return null;
    if (PROTOCOL_LIMITS.maxIntentAmount !== null && amount > PROTOCOL_LIMITS.maxIntentAmount) return "This amount is over the configured transfer cap.";
    if (balance !== null && amount > balance) return "You don't have that much USDC on this chain.";
    return null;
  }, [amount, balance]);

  const marketOnDestination = markets?.markets.find((m) => m.symbol === symbol)?.chains.find((c) => c.chainId === destination) ?? null;
  const marketPriceOut =
    marketOnDestination?.price && swapAmountIn !== null && market
      ? // chart price is 1e18-scaled USDC per token; tokens = usdc / price, expressed in token units (18 dp)
        (swapAmountIn * 10n ** 18n * 10n ** BigInt(market.tokenOut.decimals)) / (BigInt(marketOnDestination.price.e18) * 10n ** 6n)
      : null;

  const disabled = status === "CONNECTED" && (!request || !!amountError || submitting || !routerConfigured);
  const buttonLabel =
    status !== "CONNECTED" ? "Connect wallet" : submitting ? "Submitting…" : !routerConfigured ? "Router not deployed yet" : market ? `Trade USDC for ${market.tokenOut.symbol}` : "Pick a token";

  function handlePrimary() {
    if (status !== "CONNECTED") return connect();
    if (!request) return;
    void createIntent(request).then(() => onSubmitted?.());
  }

  return (
    <div className="panel p-4 sm:p-5">
      <h2 className="text-base font-semibold text-text">Trade USDC for a token</h2>

      <div className="mt-4 flex items-stretch gap-2">
        {[source, destination].map((id, index) => (
          <div key={`${id}-${index}`} className="panel-raised flex-1 px-3 py-3">
            <p className="text-xs tracking-wide text-text-dim uppercase">{index === 0 ? "From" : "To"}</p>
            <p className="mt-1 font-display text-base text-text">{CHAINS[id]?.short}</p>
            <p className="num mt-0.5 text-xs text-text-dim">{CHAINS[id]?.name}</p>
          </div>
        ))}
      </div>
      <div className="-mt-3 flex justify-center">
        <button type="button" onClick={() => onSource(destination)} aria-label="Swap direction" className="panel-raised z-10 grid size-9 place-items-center text-electric-glow transition-transform duration-[250ms] hover:rotate-180">
          ⇅
        </button>
      </div>

      <div className="panel-raised mt-2 px-3 py-3">
        <div className="flex items-center justify-between">
          <label htmlFor="trade-amount" className="text-xs tracking-wide text-text-dim uppercase">You send</label>
          <button type="button" disabled={balance === null} onClick={() => balance !== null && setAmountInput(formatUsdc(balance).replace(/,/g, ""))} className="num rounded border border-electric/35 px-1.5 py-0.5 text-[0.7rem] text-electric-glow disabled:opacity-40">
            MAX
          </button>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <input id="trade-amount" inputMode="decimal" placeholder="0.00" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} className="num w-full bg-transparent text-2xl text-text outline-none placeholder:text-text-dim/50" />
          <span className="num text-sm text-text-dim">USDC</span>
        </div>
        <p className="num mt-1 text-xs text-text-dim">
          Balance <StateValue state={balanceState} format={(b) => `${formatUsdc(b)} USDC`} />
        </p>
      </div>

      <div className="panel-raised mt-2 px-3 py-3">
        <TokenPicker
          label={`You receive on ${CHAINS[destination]?.short}`}
          value={symbol}
          onChange={onSymbol}
          options={destinationMarkets.map((m) => {
            const entry = markets?.markets.find((x) => x.symbol === m.tokenOut.symbol) ?? null;
            const live = entry?.chains.find((c) => c.chainId === destination) ?? null;
            return { symbol: m.tokenOut.symbol, name: entry?.name ?? null, price: live?.price?.display ?? null, change24hBps: live?.change24hBps ?? null };
          })}
        />
        {market ? (
          <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border/60 pt-3">
            <span className="text-xs tracking-wide text-text-dim uppercase">You receive ({quoteIsEstimate ? "estimated" : "quoted"})</span>
            <span className="num text-xl text-acid" data-testid="quoted-out">
              {!amount || amount === 0n ? "—" : <StateValue state={swap} format={(s) => `≈ ${formatTokenAmount(s.amountOut, market.tokenOut.decimals)} ${market.tokenOut.symbol}`} />}
            </span>
          </div>
        ) : null}
        {market && amount && swap.status === "error" ? (
          <p className="num mt-1 text-[11px] text-danger/80">Adapter quote failed on {CHAINS[destination]?.short} — retrying</p>
        ) : null}
      </div>

      <div className="panel-raised mt-2 px-3 py-3">
        <label htmlFor="trade-recipient" className="text-xs tracking-wide text-text-dim uppercase">Recipient on {CHAINS[destination]?.short}</label>
        <input id="trade-recipient" value={recipientInput} placeholder={address ?? "0x…"} onChange={(e) => setRecipientInput(e.target.value)} className="num mt-1 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-dim/60" />
        {recipientInput.length > 0 ? (
          <p className={cn("num mt-1 text-xs", recipientValid ? "text-success" : "text-danger")}>{recipientValid ? truncateAddress(recipient) : "Enter a valid 0x address"}</p>
        ) : (
          <p className="mt-1 text-xs text-text-dim">Leave blank to receive at your own address.</p>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-text">Max fast-fill fee</span>
            <span className="num text-xs text-text-dim">{formatBps(maxFeeBps)}{amount ? ` · ≤ ${formatUsdc(feeFromBps(amount, maxFeeBps))} USDC` : ""}</span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {FEE_OPTIONS.map((bps) => (
              <button key={bps} type="button" onClick={() => setMaxFeeBps(bps)} className={cn("num rounded-md border py-1.5 text-xs transition-colors", bps === maxFeeBps ? "border-electric/60 bg-electric/15 text-electric-glow" : "border-border text-text-dim hover:text-text")}>
                {formatBps(bps)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-text">Slippage tolerance</span>
            <span className="num text-xs text-text-dim">{(slippageBps / 100).toFixed(1)}%</span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {SLIPPAGE_OPTIONS.map((bps) => (
              <button key={bps} type="button" onClick={() => setSlippageBps(bps)} className={cn("num rounded-md border py-1.5 text-xs transition-colors", bps === slippageBps ? "border-acid/60 bg-acid/15 text-acid" : "border-border text-text-dim hover:text-text")}>
                {(bps / 100).toFixed(1)}%
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-text-dim">
        The minimum below is prefilled at the adapter's quote less your tolerance; type your own to override it. That number is written into the intent. If no vault can deliver at least that much {market?.tokenOut.symbol ?? "token"}, you receive USDC instead — nothing is stranded.
      </p>

      <div className="mt-4 border-t border-border pt-4">
        {!amount ? (
          <p className="text-sm text-text-dim">Enter an amount to request a quote.</p>
        ) : amountError ? (
          <p className="text-sm text-danger">{amountError}</p>
        ) : !market ? (
          <p className="text-sm text-text-dim">Pick the token to receive.</p>
        ) : (
          <dl className="space-y-1.5 text-sm">
            {quote.status === "ready" && quote.data.verdict !== "ACCEPT" ? (
              <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">
                Solver would decline this right now: {humaniseQuoteReason(quote.data.reason)}. You can still send it — a vault that can take it fills, otherwise USDC arrives by canonical settlement.
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-text-dim">Fast-fill fee</dt>
              <dd className="num text-text"><StateValue state={quote} format={(q) => `${formatUsdc(q.feeAmount)} USDC · ${formatBps(q.feeBps)}`} /></dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-dim">Swapped by the vault</dt>
              <dd className="num text-text"><StateValue state={quote} format={(q) => `${formatUsdc(q.outputAmount)} USDC`} /></dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text">
                <label htmlFor="trade-floor">Minimum you accept</label>
              </dt>
              <dd className="num flex items-baseline gap-1 text-text">
                <input
                  id="trade-floor"
                  inputMode="decimal"
                  value={floorInput}
                  onChange={(e) => {
                    setFloorTouched(true);
                    setFloorInput(e.target.value);
                  }}
                  placeholder={suggestedFloor !== null ? floorInputText(suggestedFloor, market.tokenOut.decimals) : "0.0"}
                  className="w-44 rounded-md border border-border bg-void px-2 py-1 text-right text-sm text-text outline-none focus:border-acid/60"
                />
                <span className="text-text-dim">{market.tokenOut.symbol}</span>
              </dd>
            </div>
            {floorTouched && suggestedFloor !== null ? (
              <p className="num text-right text-[11px] text-text-dim">
                Suggested {formatTokenAmount(suggestedFloor, market.tokenOut.decimals)} ({(slippageBps / 100).toFixed(1)}% under the quote) ·{" "}
                <button type="button" className="text-acid hover:underline" onClick={() => { setFloorTouched(false); }}>use it</button>
              </p>
            ) : null}
            {targetMinOut !== null && swap.status === "ready" && targetMinOut > swap.data.amountOut ? (
              <p className="num text-right text-[11px] text-warning">Above the current quote — no vault can meet it, so USDC would arrive instead.</p>
            ) : null}
            {marketPriceOut !== null ? (
              <div className="flex justify-between">
                <dt className="text-text-dim">At the chart price, for context</dt>
                <dd className="num text-text-dim">{formatTokenAmount(marketPriceOut, market.tokenOut.decimals)} {market.tokenOut.symbol}</dd>
              </div>
            ) : null}
            <p className="num pt-1 text-right text-[10px] uppercase tracking-wide text-text-dim/70">
              {quoteIsEstimate ? `Adapter quote for ${formatUsdc(swapAmountIn ?? 0n)} USDC after an assumed ${formatBps(assumedFeeBps)} fee` : "Quoted by the destination adapter for this exact size"} · not the chart price
            </p>
          </dl>
        )}
        {swap.status === "error" && market && swapAmountIn !== null ? (
          <p className="num mt-2 text-[11px] uppercase tracking-wide text-danger/80">Adapter quote failed — no floor can be set</p>
        ) : null}
      </div>

      <button type="button" onClick={handlePrimary} disabled={disabled} className={cn("mt-4 w-full rounded-lg bg-electric py-3 text-sm font-semibold text-primary-foreground transition-opacity glow-electric", disabled && "opacity-45")}>
        {buttonLabel}
      </button>
      {submitError ? <p className="mt-2 text-center text-xs text-warning">{submitError}</p> : null}
    </div>
  );
}
