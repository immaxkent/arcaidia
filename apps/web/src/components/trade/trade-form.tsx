import { useEffect, useMemo, useState } from "react";
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

  // The adapter's quote for that USDC → tokenOut, on the destination chain.
  const swap = useSwapQuote(destination, (market?.tokenOut.address as Address | undefined) ?? null, quotedUsdcOut);
  const targetMinOut = swap.status === "ready" ? targetMinOutFrom(swap.data.amountOut, slippageBps) : null;

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
    marketOnDestination?.price && quotedUsdcOut !== null && market
      ? // chart price is 1e18-scaled USDC per token; tokens = usdc / price, expressed in token units (18 dp)
        (quotedUsdcOut * 10n ** 18n * 10n ** BigInt(market.tokenOut.decimals)) / (BigInt(marketOnDestination.price.e18) * 10n ** 6n)
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
        The floor is the adapter's quote less your tolerance. If no vault can deliver at least that much {market?.tokenOut.symbol ?? "token"}, you receive USDC instead — nothing is stranded.
      </p>

      <div className="mt-4 border-t border-border pt-4">
        {!amount ? (
          <p className="text-sm text-text-dim">Enter an amount to request a quote.</p>
        ) : amountError ? (
          <p className="text-sm text-danger">{amountError}</p>
        ) : !market ? (
          <p className="text-sm text-text-dim">Pick the token to receive.</p>
        ) : quote.status === "ready" && quote.data.verdict !== "ACCEPT" ? (
          <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">{humaniseQuoteReason(quote.data.reason)}</div>
        ) : (
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-dim">Fast-fill fee</dt>
              <dd className="num text-text"><StateValue state={quote} format={(q) => `${formatUsdc(q.feeAmount)} USDC · ${formatBps(q.feeBps)}`} /></dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-dim">Swapped by the vault</dt>
              <dd className="num text-text"><StateValue state={quote} format={(q) => `${formatUsdc(q.outputAmount)} USDC`} /></dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text">You receive (quoted)</dt>
              <dd className="num text-acid" data-testid="quoted-out">
                <StateValue state={swap} format={(s) => `≈ ${formatTokenAmount(s.amountOut, market.tokenOut.decimals)} ${market.tokenOut.symbol}`} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-dim">Minimum you accept</dt>
              <dd className="num text-text">{targetMinOut !== null ? `${formatTokenAmount(targetMinOut, market.tokenOut.decimals)} ${market.tokenOut.symbol}` : "—"}</dd>
            </div>
            {marketPriceOut !== null ? (
              <div className="flex justify-between">
                <dt className="text-text-dim">At the chart price, for context</dt>
                <dd className="num text-text-dim">{formatTokenAmount(marketPriceOut, market.tokenOut.decimals)} {market.tokenOut.symbol}</dd>
              </div>
            ) : null}
            <p className="num pt-1 text-right text-[10px] uppercase tracking-wide text-text-dim/70">
              Quoted by the destination adapter for this exact size · not the chart price
            </p>
          </dl>
        )}
        {swap.status === "error" && market && quotedUsdcOut !== null ? (
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
