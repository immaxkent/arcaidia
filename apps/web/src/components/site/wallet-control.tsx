import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet, useWalletBalance } from "@/components/wallet/wallet-context";
import { ARC_TESTNET, CHAINS, ETHEREUM_SEPOLIA } from "@/lib/arcaidia/types";
import { formatUsdc, truncateAddress } from "@/lib/arcaidia/format";
import { StateValue } from "@/components/data/state-views";
import { Button } from "@/components/ui/button";

export function WalletControl() {
  const { status, address, chainId, connect, disconnect, switchChain, loginConfigured } = useWallet();
  const balance = useWalletBalance(chainId);

  if (status !== "CONNECTED" || !address) {
    return (
      <Button
        type="button"
        onClick={connect}
        disabled={status === "CONNECTING"}
        title={loginConfigured ? undefined : "Wallet sign-in is not connected yet"}
        variant="outline"
        className="control-button h-9 border-2 border-acid bg-acid/10 px-4 font-display text-base uppercase text-acid hover:bg-acid hover:text-void"
      >
        {status === "CONNECTING" ? "Connecting…" : "Connect"}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="control-button flex items-center gap-2.5 border-2 border-acid bg-acid/10 px-3 py-1.5 text-sm">
        <span className="num text-text">{truncateAddress(address)}</span>
        <span className="hidden num text-xs text-text-dim sm:inline">
          <StateValue state={balance} format={(b) => `${formatUsdc(b)} USDC`} />
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-dim">
          {CHAINS[chainId]?.short}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-text-dim">Wallet</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => {
            navigator.clipboard?.writeText(address);
            toast.success("Address copied");
          }}
        >
          Copy address
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-text-dim">Network</DropdownMenuLabel>
        {[ETHEREUM_SEPOLIA, ARC_TESTNET].map((id) => (
          <DropdownMenuItem key={id} onClick={() => switchChain(id)}>
            {CHAINS[id]?.name}
            {id === chainId ? <span className="ml-auto text-electric">active</span> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={disconnect} className="text-danger">
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
