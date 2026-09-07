import { toast } from "sonner";
import type { Address, Hex } from "@/lib/arcaidia/types";
import { truncateAddress } from "@/lib/arcaidia/format";
import { cn } from "@/lib/utils";

export function CopyValue({
  value,
  label,
  className,
}: {
  value: Address | Hex;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={value}
      aria-label={`Copy ${label ?? "value"} ${value}`}
      onClick={() => {
        navigator.clipboard?.writeText(value);
        toast.success("Copied", { description: truncateAddress(value, 10, 8) });
      }}
      className={cn(
        "num rounded-sm text-text-dim transition-colors hover:text-electric-glow",
        className,
      )}
    >
      {truncateAddress(value)}
    </button>
  );
}
