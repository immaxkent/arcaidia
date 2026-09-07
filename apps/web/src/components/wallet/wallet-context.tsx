import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { toast } from "sonner";
import { ETHEREUM_SEPOLIA, type Address } from "@/lib/arcaidia/types";
import { SERVICES, SUPPORTED_CHAIN_IDS } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import { useUsdcBalance } from "@/hooks/arcaidia/use-usdc-balance";

/**
 * Human owner identity boundary.
 *
 * Backed by Privy (`@privy-io/react-auth`) — an embedded wallet by default, no
 * seed phrase, no extension. This is the HUMAN / vault-owner identity; it never
 * holds a solver operator key (that is a separate identity entirely — see
 * WP-INTENT-MARKET.md's pairing model, post-V1).
 *
 * Two internal implementations exist because a Privy hook cannot be called
 * without a `PrivyProvider` ancestor, and `ArcaidiaPrivyProvider` mounts no
 * provider at all when `VITE_PRIVY_APP_ID` is unset (see privy-provider.tsx).
 * The choice between them is a static, build-time fact — not something that
 * changes across a render — so switching the whole component tree on it does
 * not violate the rules of hooks. Every consumer of `useWallet()` sees one
 * identical shape either way.
 */
export type WalletStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED";

interface WalletValue {
  status: WalletStatus;
  address: Address | null;
  /** Active chain from the wallet/RPC once connected; before that, the user's UI selection. */
  chainId: number;
  /** False until Privy is configured — the UI explains this instead of pretending. */
  loginConfigured: boolean;
  connect: () => void;
  disconnect: () => void;
  switchChain: (chainId: number) => void;
}

const WalletContext = createContext<WalletValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  return SERVICES.privyAppId ? (
    <ConfiguredWalletProvider>{children}</ConfiguredWalletProvider>
  ) : (
    <UnconfiguredWalletProvider>{children}</UnconfiguredWalletProvider>
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
    (next: number) => {
      const target = SUPPORTED_CHAIN_IDS.includes(next as never) ? next : ETHEREUM_SEPOLIA;
      setChainId(target);
      if (activeWallet) {
        // Privy throws if the target chain is not in supportedChains (see
        // privy-provider.tsx) — both chains are always registered there, so
        // this should never surface, but a failed switch must not silently
        // leave the UI pointed at a chain the wallet disagrees with.
        activeWallet.switchChain(target).catch((error: unknown) => {
          toast.error("Could not switch network", {
            description: error instanceof Error ? error.message : "Wallet rejected the chain switch.",
          });
        });
      }
    },
    [activeWallet],
  );

  const value = useMemo<WalletValue>(
    () => ({ status, address, chainId, loginConfigured: true, connect, disconnect, switchChain }),
    [status, address, chainId, connect, disconnect, switchChain],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** No Privy app id configured for this deployment — honest, not faked. */
function UnconfiguredWalletProvider({ children }: { children: ReactNode }) {
  const [chainId, setChainId] = useState<number>(ETHEREUM_SEPOLIA);

  const connect = useCallback(() => {
    toast.error("Wallet sign-in is not connected yet", {
      description: "Privy login is not configured for this deployment.",
    });
  }, []);

  const disconnect = useCallback(() => {}, []);

  const value = useMemo<WalletValue>(
    () => ({
      status: "DISCONNECTED",
      address: null,
      chainId,
      loginConfigured: false,
      connect,
      disconnect,
      switchChain: (next: number) =>
        setChainId(SUPPORTED_CHAIN_IDS.includes(next as never) ? next : ETHEREUM_SEPOLIA),
    }),
    [chainId, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

/** USDC balance for the connected owner on a chain. Never a fabricated number. */
export function useWalletBalance(chainId: number): DataState<bigint> {
  const { address, status } = useWallet();
  const state = useUsdcBalance(chainId, address);
  if (status !== "CONNECTED") return unavailableState("Connect wallet");
  return state;
}
