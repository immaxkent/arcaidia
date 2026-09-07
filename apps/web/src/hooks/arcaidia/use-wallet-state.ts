/**
 * Human owner identity. WIRE: Privy (`@privy-io/react-auth`) — usePrivy/useWallets —
 * plus viem for the active chain. The Privy wallet is the HUMAN / vault owner
 * identity; it never holds a solver operator key.
 *
 * Until `VITE_PRIVY_APP_ID` is configured, login is reported as unavailable and
 * no address, chain or balance is invented.
 */
import { useWallet } from "@/components/wallet/wallet-context";

export function useWalletState() {
  return useWallet();
}
