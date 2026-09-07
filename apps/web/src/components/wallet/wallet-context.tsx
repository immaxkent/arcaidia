import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ETHEREUM_SEPOLIA, type Address } from "@/lib/arcaidia/types";
import { SERVICES, SUPPORTED_CHAIN_IDS } from "@/lib/arcaidia/config";
import { unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import { useUsdcBalance } from "@/hooks/arcaidia/use-usdc-balance";

/**
 * HANDOFF — human owner identity boundary.
 *
 * WIRE: Privy (`@privy-io/react-auth`). Replace this provider's internals with
 * usePrivy()/useWallets() and keep this exact surface; every consumer reads only
 * this context. The Privy wallet is the HUMAN / vault-owner identity — it never
 * holds a solver operator key.
 *
 * Until VITE_PRIVY_APP_ID is set there is NO connected wallet, NO address, NO
 * chain assumption beyond the configured supported chains, and NO balance.
 * Nothing is faked here.
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
  const [status, setStatus] = useState<WalletStatus>("DISCONNECTED");
  const [chainId, setChainId] = useState<number>(ETHEREUM_SEPOLIA);
  const loginConfigured = SERVICES.privyAppId !== null;

  const connect = useCallback(() => {
    if (!loginConfigured) {
      toast.error("Wallet sign-in is not connected yet", {
        description: "Privy login is not configured for this deployment.",
      });
      return;
    }
    // TODO(integration): privy.login(), then read the active wallet + chain.
    setStatus("DISCONNECTED");
    toast.error("Wallet sign-in is not connected yet");
  }, [loginConfigured]);

  const disconnect = useCallback(() => {
    setStatus("DISCONNECTED");
  }, []);

  const value = useMemo<WalletValue>(
    () => ({
      status,
      address: null,
      chainId,
      loginConfigured,
      connect,
      disconnect,
      switchChain: (next: number) =>
        setChainId(SUPPORTED_CHAIN_IDS.includes(next as never) ? next : ETHEREUM_SEPOLIA),
    }),
    [status, chainId, loginConfigured, connect, disconnect],
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
