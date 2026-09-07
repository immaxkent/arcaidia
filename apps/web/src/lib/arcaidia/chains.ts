import { defineChain } from "viem";
import { sepolia } from "viem/chains";

// Arc is not in viem/chains — declare it so both directions of the product work.
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
});

/** Both chains must be present or one direction of the product breaks. */
export const supportedChains = [sepolia, arcTestnet] as const;
