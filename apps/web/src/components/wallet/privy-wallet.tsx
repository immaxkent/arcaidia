/**
 * The Privy half of the wallet boundary — everything that imports `@privy-io/react-auth`.
 * Loaded by `WalletProvider` in the browser only (see wallet-context.tsx). Do not import this
 * module from anything that renders on the server.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type WalletClient } from "viem";
import { toast } from "sonner";
import { ETHEREUM_SEPOLIA, type Address } from "@/lib/arcaidia/types";
import { SUPPORTED_CHAIN_IDS } from "@/lib/arcaidia/config";
import { viemChainFor } from "@/lib/arcaidia/viem-chains";
import { ArcaidiaPrivyProvider } from "./privy-provider";
import { WalletContext, type WalletStatus, type WalletValue } from "./wallet-context";

export function PrivyWalletProvider({ children }: { children: ReactNode }) {
  return (
    <ArcaidiaPrivyProvider>
      <ConfiguredWalletProvider>{children}</ConfiguredWalletProvider>
    </ArcaidiaPrivyProvider>
  );
}

/** Real Privy — rendered only inside `ArcaidiaPrivyProvider`'s mounted context. */
function ConfiguredWalletProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const [chainId, setChainId] = useState<number>(ETHEREUM_SEPOLIA);

  // The embedded wallet Privy created on login, or the first connected wallet.
  const activeWallet = wallets[0];
  const address = (activeWallet?.address as Address | undefined) ?? null;

  const status: WalletStatus = !ready ? "CONNECTING" : authenticated && address ? "CONNECTED" : "DISCONNECTED";

  const connect = useCallback(() => {
    login();
  }, [login]);

  const disconnect = useCallback(() => {
    logout();
  }, [logout]);

  const switchChain = useCallback(
    async (next: number) => {
      const target = SUPPORTED_CHAIN_IDS.includes(next as never) ? next : ETHEREUM_SEPOLIA;
      setChainId(target);
      if (activeWallet) {
        // Privy throws if the target chain is not in supportedChains (see
        // privy-provider.tsx) — both chains are always registered there, so
        // this should never surface, but a failed switch must not silently
        // leave the UI pointed at a chain the wallet disagrees with.
        try {
          await activeWallet.switchChain(target);
        } catch (error) {
          toast.error("Could not switch network", {
            description: error instanceof Error ? error.message : "Wallet rejected the chain switch.",
          });
          throw error;
        }
      }
    },
    [activeWallet],
  );

  const getWalletClient = useCallback(
    async (targetChainId: number) => {
      if (!activeWallet || !address) throw new Error("No wallet connected.");
      const provider = await activeWallet.getEthereumProvider();
      return createWalletClient({
        account: address,
        chain: viemChainFor(targetChainId),
        transport: custom(provider),
      });
    },
    [activeWallet, address],
  );

  const value = useMemo<WalletValue>(
    () => ({ status, address, chainId, loginConfigured: true, connect, disconnect, switchChain, getWalletClient }),
    [status, address, chainId, connect, disconnect, switchChain, getWalletClient],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
