import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { createWalletClient, custom, type WalletClient } from "viem";
import { toast } from "sonner";
import { ETHEREUM_SEPOLIA, type Address } from "@/lib/arcaidia/types";
import { SERVICES, SUPPORTED_CHAIN_IDS } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import { useUsdcBalance } from "@/hooks/arcaidia/use-usdc-balance";
import { viemChainFor } from "@/lib/arcaidia/viem-chains";

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

export interface WalletValue {
  status: WalletStatus;
  address: Address | null;
  /** Active chain from the wallet/RPC once connected; before that, the user's UI selection. */
  chainId: number;
  /** False until Privy is configured — the UI explains this instead of pretending. */
  loginConfigured: boolean;
  connect: () => void;
  disconnect: () => void;
  /** Resolves once the wallet is on `chainId` (a rejected switch rejects). */
  switchChain: (chainId: number) => Promise<void>;
  /** A viem WalletClient for the active wallet, for signing a transaction on `chainId`. */
  getWalletClient: (chainId: number) => Promise<WalletClient>;
}

export const WalletContext = createContext<WalletValue | null>(null);

/**
 * Privy is loaded in the browser only. Its package carries the Hedera SDK, whose server-side
 * evaluation breaks under the bundled `buffer` shim (every server render 500'd on Vercel), and
 * a wallet has no meaning during server rendering anyway. Until the module arrives the tree
 * renders with a "connecting" wallet, then swaps to the real provider once, before any
 * interaction is possible.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [Privy, setPrivy] = useState<ComponentType<{ children: ReactNode }> | null>(null);
  useEffect(() => {
    if (!SERVICES.privyAppId) return;
    let cancelled = false;
    void import("./privy-wallet").then((m) => {
      if (!cancelled) setPrivy(() => m.PrivyWalletProvider);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!SERVICES.privyAppId) return <UnconfiguredWalletProvider>{children}</UnconfiguredWalletProvider>;
  return Privy ? <Privy>{children}</Privy> : <ConnectingWalletProvider>{children}</ConnectingWalletProvider>;
}

/** Before Privy has loaded in the browser (and on the server): configured, not yet ready. */
function ConnectingWalletProvider({ children }: { children: ReactNode }) {
  const [chainId, setChainId] = useState<number>(ETHEREUM_SEPOLIA);
  const value = useMemo<WalletValue>(
    () => ({
      status: "CONNECTING",
      address: null,
      chainId,
      loginConfigured: true,
      connect: () => {},
      disconnect: () => {},
      switchChain: async (next: number) => {
        setChainId(next);
      },
      getWalletClient: async () => {
        throw new Error("Wallet not ready yet.");
      },
    }),
    [chainId],
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

  const getWalletClient = useCallback(async (): Promise<never> => {
    throw new Error("Wallet sign-in is not connected yet.");
  }, []);

  const value = useMemo<WalletValue>(
    () => ({
      status: "DISCONNECTED",
      address: null,
      chainId,
      loginConfigured: false,
      connect,
      disconnect,
      switchChain: async (next: number) => {
        setChainId(SUPPORTED_CHAIN_IDS.includes(next as never) ? next : ETHEREUM_SEPOLIA);
      },
      getWalletClient,
    }),
    [chainId, connect, disconnect, getWalletClient],
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
