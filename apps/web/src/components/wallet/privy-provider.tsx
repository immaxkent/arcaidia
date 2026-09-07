/**
 * Privy's provider, mounted only when configured.
 *
 * Rendering `<PrivyProvider appId={undefined}>` is not a graceful no-op — Privy
 * expects a real app id and errors without one. So this is a hard branch, not a
 * default prop: with no `VITE_PRIVY_APP_ID`, Privy's context never mounts at
 * all, and `WalletProvider` (below) must not call any Privy hook in that case —
 * see the dispatch in `wallet-context.tsx`.
 */
import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { SERVICES } from "@/lib/arcaidia/config";
import { SUPPORTED_VIEM_CHAINS, ethereumSepoliaChain } from "@/lib/arcaidia/viem-chains";

/**
 * viem's `Chain` and Privy's own `@privy-io/chains` `Chain` are structurally
 * the same shape — Privy's own documentation shows importing directly from
 * `viem/chains` here. The cast exists only because our `exactOptionalPropertyTypes`
 * is stricter than Privy's declaration file anticipates for optional fields
 * (e.g. `blockExplorers`), not because the values themselves are wrong.
 */
const chainConfig = {
  defaultChain: ethereumSepoliaChain,
  supportedChains: [...SUPPORTED_VIEM_CHAINS],
} as unknown as Pick<PrivyClientConfig, "defaultChain" | "supportedChains">;

export function ArcaidiaPrivyProvider({ children }: { children: ReactNode }) {
  if (!SERVICES.privyAppId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={SERVICES.privyAppId}
      config={{
        appearance: { theme: "dark", accentColor: "#2E9BFF" },
        // Embedded wallets by default — the demo path: email/social sign-in,
        // no seed phrase, no extension required.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        ...chainConfig,
      }}
    >
      {children}
    </PrivyProvider>
  );
}
