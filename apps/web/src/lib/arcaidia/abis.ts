/**
 * Contract interfaces used by the frontend. Centralised so no presentation
 * component embeds an ABI fragment.
 *
 * INTEGRATION NOTE
 * ----------------
 * These are the minimal fragments the UI needs. Replace them with the generated
 * ABIs from the protocol repo at handoff — the shapes below are what the hooks in
 * src/hooks/arcaidia expect.
 */

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

/** IntentRouter: createIntent + the IntentCreated event the UI waits on. */
export const intentRouterAbi = [
  {
    type: "function",
    name: "createIntent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "inputToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "maxFeeBps", type: "uint16" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [{ name: "intentId", type: "bytes32" }],
  },
  {
    type: "event",
    name: "IntentCreated",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "destinationChainId", type: "uint256", indexed: false },
      { name: "maxFeeBps", type: "uint16", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
    ],
  },
] as const;

/** SolverVault: direct current-state reads plus owner controls. */
export const solverVaultAbi = [
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "availableLiquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "outstandingExposure",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "authorisedSolver",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "authoriseSolver",
    stateMutability: "nonpayable",
    inputs: [{ name: "operator", type: "address" }],
    outputs: [],
  },
  { type: "function", name: "revokeSolver", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

export type VaultCapability = "pause" | "revokeSolver" | "replaceSolver";

/**
 * Owner safety controls render only when the deployed ABI exposes them.
 * Capabilities are unknown until a vault ABI is actually read from a deployment,
 * so nothing is assumed here.
 */
export function vaultCapabilitiesFromAbi(
  abi: ReadonlyArray<{ type: string; name?: string }> | null,
): Record<VaultCapability, boolean> | null {
  if (!abi) return null;
  const has = (name: string) => abi.some((f) => f.type === "function" && f.name === name);
  return {
    pause: has("pause"),
    revokeSolver: has("revokeSolver"),
    replaceSolver: has("authoriseSolver"),
  };
}
