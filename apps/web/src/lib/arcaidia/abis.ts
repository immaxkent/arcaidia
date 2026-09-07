/**
 * Contract interfaces used by the frontend. Centralised so no presentation
 * component embeds an ABI fragment.
 *
 * `intentRouterAbi` and `solverVaultAbi` are the real generated ABIs from
 * @arcaidia/domain (built from the Foundry output) — never hand-write a
 * fragment here, it will drift from the deployed contract's real signature.
 */
import { ABIS } from "@arcaidia/domain";

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const intentRouterAbi = ABIS.ArcaidiaIntentRouter;

/** ArcaidiaLiquidityVault (ERC-4626 + solver-authorisation surface). */
export const solverVaultAbi = ABIS.ArcaidiaLiquidityVault;

export type VaultCapability = "pause" | "revokeSolver" | "replaceSolver";

/**
 * Owner safety controls render only when the deployed ABI exposes them.
 * Capabilities are unknown until a vault ABI is actually read from a deployment,
 * so nothing is assumed here.
 *
 * The real vault has a single `setAuthorisedSigner(signer, allowed)` for both
 * granting and revoking a signer — there is no separate revoke function — so
 * `revokeSolver` and `replaceSolver` both key off its presence.
 */
export function vaultCapabilitiesFromAbi(
  abi: ReadonlyArray<{ type: string; name?: string }> | null,
): Record<VaultCapability, boolean> | null {
  if (!abi) return null;
  const has = (name: string) => abi.some((f) => f.type === "function" && f.name === name);
  const canManageSigners = has("setAuthorisedSigner");
  return {
    pause: has("setPaused"),
    revokeSolver: canManageSigners,
    replaceSolver: canManageSigners,
  };
}
