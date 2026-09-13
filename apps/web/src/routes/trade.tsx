import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TradeForm } from "@/components/trade/trade-form";
import { PriceChart } from "@/components/trade/price-chart";
import { DecisionPanel } from "@/components/transfer/decision-panel";
import { AllTransfersPanel, IntentHistoryPanel } from "@/components/transfer/intent-history-panel";
import { useWallet } from "@/components/wallet/wallet-context";
import { IntentProvider } from "@/hooks/arcaidia/use-intent";
import { marketBySymbol, useMarkets, usePriceHistory, type TimeframeId } from "@/hooks/arcaidia/use-market-prices";
import { tradeAvailability } from "@/lib/arcaidia/trade-gating";
import { ARC_TESTNET, ETHEREUM_SEPOLIA, type AgentDecision } from "@/lib/arcaidia/types";

export const Route = createFileRoute("/trade")({
  head: () => ({
    meta: [
      { title: "Trade — Arcaidia" },
      {
        name: "description",
        content: "Send USDC across chains and receive a different token on the far side, with a live price chart for the token you picked and the spread between the two chains.",
      },
      { property: "og:title", content: "Trade — Arcaidia" },
      { property: "og:description", content: "USDC in on one chain, the token you chose out on the other. Live candles, the cross-chain spread, and an honest floor." },
    ],
  }),
  component: TradePage,
});

function TradePage() {
  return (
    <IntentProvider>
      <TradePageContent />
    </IntentProvider>
  );
}

function TradePageContent() {
  const { status, address, connect } = useWallet();
  const [source, setSource] = useState(ETHEREUM_SEPOLIA);
  const destination = source === ETHEREUM_SEPOLIA ? ARC_TESTNET : ETHEREUM_SEPOLIA;
  const [symbol, setSymbol] = useState<string | null>("mETH");
  const [timeframe, setTimeframe] = useState<TimeframeId>("24h");
  const [liveQuote, setLiveQuote] = useState<AgentDecision | null>(null);

  const availability = tradeAvailability(destination);
  const markets = useMarkets();
  const marketsData = markets.status === "ready" ? markets.data : null;
  const market = marketBySymbol(marketsData, symbol);
  const destinationSpot = market?.chains.find((c) => c.chainId === destination) ?? null;
  const originSpot = market?.chains.find((c) => c.chainId === source) ?? null;
  const destinationHistory = usePriceHistory(destination, availability.chart.available ? symbol : null, timeframe);
  const originHistory = usePriceHistory(source, availability.chart.available ? symbol : null, timeframe);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold text-text sm:text-3xl">Trade</h1>
      <p className="measure mt-2 text-sm text-text-dim">
        USDC leaves one chain; the token you pick arrives on the other. The vault that wins the fill swaps for you on the destination
        chain, and if the swap cannot meet your floor you receive USDC instead. Prices differ per chain on purpose.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(360px,420px)_1fr] lg:gap-8">
        <div>
          {availability.form.available ? (
            <TradeForm source={source} onSource={setSource} symbol={symbol} onSymbol={setSymbol} markets={marketsData} onQuoteChange={setLiveQuote} />
          ) : (
            <div className="panel p-5">
              <h2 className="text-base font-semibold text-text">Trading not available here</h2>
              <p className="mt-2 text-sm text-text-dim">{availability.form.reason}</p>
            </div>
          )}
        </div>
        <div className="space-y-6">
          {availability.chart.available ? (
            <PriceChart
              symbol={symbol}
              destinationChainId={destination}
              originChainId={source}
              destinationHistory={destinationHistory}
              originHistory={originHistory}
              destinationSpot={destinationSpot}
              originSpot={originSpot}
              timeframe={timeframe}
              onTimeframe={setTimeframe}
            />
          ) : (
            <div className="panel p-5">
              <h2 className="text-base font-semibold text-text">No price chart</h2>
              <p className="mt-2 text-sm text-text-dim">{availability.chart.reason}</p>
            </div>
          )}

          {status !== "CONNECTED" ? (
            <div className="panel px-4 py-3">
              <p className="text-sm text-text-dim">Connect a wallet to create a trade and track its settlement here.</p>
              <button type="button" onClick={connect} className="mt-3 rounded-md border border-acid/60 bg-acid/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-acid">
                Connect wallet
              </button>
            </div>
          ) : null}

          <DecisionPanel decision={liveQuote} />
          <IntentHistoryPanel owner={address} kind="trades" />
          <AllTransfersPanel kind="trades" />
        </div>
      </div>
    </div>
  );
}
