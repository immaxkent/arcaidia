// Types mirror the Arcaidia backend contracts (frontend spec §7). Do not change shapes.

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

// Two settlement facts. Never merge them.
export type FastStatus = "PENDING" | "FAST_FILLED";
export type CanonicalStatus = "PENDING" | "SETTLED";
export type CanonicalOutcome = "LP_REIMBURSED" | "RECIPIENT_FALLBACK";

export interface Intent {
  intentId: Hex;
  sender: Address;
  recipient: Address;
  inputToken: Address;
  amount: bigint; // 6 decimals (USDC)
  sourceChainId: number; // 11155111 Ethereum Sepolia | 5042002 Arc testnet
  destinationChainId: number;
  maxFeeBps: number;
  deadline: number;
  createdAt: number;
  sourceTxHash?: Hex;
}

export interface IntentSettlementState {
  intentId: Hex;
  fastStatus: FastStatus;
  canonicalStatus: CanonicalStatus;
  canonicalOutcome?: CanonicalOutcome;
  fastFilledAt?: number;
  settledAt?: number;
}

export type Verdict = "ACCEPT" | "REJECT" | "PAUSE";

export interface DecisionInputs {
  requestedAmount: bigint;
  availableLiquidity: bigint;
  reserveFloor: bigint;
  outstandingExposure: bigint;
  utilisationBps: number;
  userMaxFeeBps: number;
  sourceConfirmations: number;
  requiredConfirmations: number;
  observationAgeSeconds: number;
  settlementHealth: {
    transport: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
    oldestUnsettledAgeSeconds: number | null;
    pendingValue: bigint;
    averageSettlementLatencySeconds: number | null;
  };
}

export interface AgentDecision {
  intentId: Hex;
  verdict: Verdict;
  reason: string;
  feeBps: number;
  feeAmount: bigint;
  outputAmount: bigint;
  policyVersion: string;
  decidedAt: number;
  inputsUsed: DecisionInputs;
}

export interface VaultState {
  chainId: number;
  vault: Address;
  asset: Address;
  totalBalance: bigint; // everything held, including protocol fees
  totalShares: bigint;
  reserveFloor: bigint;
  outstandingExposure: bigint; // advanced, awaiting reimbursement
  accruedProtocolFees: bigint; // held but owed to treasury — NOT LP capital
  paused: boolean;
  observedAt: number;
}

export const ETHEREUM_SEPOLIA = 11155111;
export const ARC_TESTNET = 5042002;

export interface ChainMeta {
  id: number;
  name: string;
  short: string;
  explorer: string;
}

export const CHAINS: Record<number, ChainMeta> = {
  [ETHEREUM_SEPOLIA]: {
    id: ETHEREUM_SEPOLIA,
    name: "Ethereum Sepolia",
    short: "Ethereum",
    explorer: "https://sepolia.etherscan.io",
  },
  [ARC_TESTNET]: {
    id: ARC_TESTNET,
    name: "Arc Testnet",
    short: "Arc",
    explorer: "https://testnet.arcscan.app",
  },
};

// --- Permissionless vault market (extension brief §9) ---

export type OperatorType = "HOUSE" | "INDEPENDENT";
export type VaultStatus = "ACTIVE" | "PAUSED" | "WINDING_DOWN";

export interface VaultCard {
  chainId: number;
  vaultAddress: Address;
  operatorLabel: string;
  operatorType: OperatorType;
  availableLiquidity: bigint;
  outstandingExposure: bigint;
  utilisationBps: number;
  pricingModelId: string;
  currentFeeBps: number;
  successfulFillCount: number;
  lifetimeFees: bigint;
  status: VaultStatus;
}

export interface FillRow {
  intentId: Hex;
  sourceChainId: number;
  destinationChainId: number;
  amountAdvanced: bigint;
  feeAmount: bigint;
  fastFillTimestamp: number;
  canonicalStatus: CanonicalStatus;
  settlementLatencySeconds: number | null;
  sourceTxHash: Hex;
  destinationTxHash: Hex;
}

// --- Solver authorisation + console (solver architecture) ---

/**
 * The vault owner is a human identity (Privy). The solver runs elsewhere and owns
 * its own operator key — an EOA or a supported Circle Agent Wallet. Arcaidia never
 * sees that key; it only validates the operator address the owner authorises onchain.
 */
export type SolverKind = "REFERENCE" | "EXTERNAL";
export type SolverAuthState = "UNAUTHORISED" | "PENDING_SIGNATURE" | "AUTHORISED" | "REVOKED";
export type SolverRuntimeStatus = "ONLINE" | "OFFLINE" | "PAUSED";
export type SolverDeployTarget = "DOCKER" | "VPS" | "LOCAL" | "KUBERNETES";

/** Informational (solver telemetry) vs onchain-confirmed (RPC / contract / Subgraph). */
export type SolverStageSource = "TELEMETRY" | "ONCHAIN";

export type SolverStageId =
  | "SCANNING"
  | "INTENT_DISCOVERED"
  | "VERIFYING_SOURCE"
  | "FORMULATING_FILL"
  | "SUBMITTING_SETTLEMENT"
  | "AWAITING_CONFIRMATION"
  | "FAST_FILL_CONFIRMED"
  | "AWAITING_CANONICAL_SETTLEMENT"
  | "SETTLED"
  | "LOST_RACE";

export interface SolverStageMeta {
  id: SolverStageId;
  label: string;
  source: SolverStageSource;
}

/** A vault the connected owner controls, as discovered from their owner address. */
export interface OwnedVault {
  chainId: number;
  vaultAddress: Address;
  label: string;
  /** Operator address authorised onchain for this vault, if any. */
  authorisedSolver: Address | null;
  solverAuthState: SolverAuthState;
  solverKind: SolverKind | null;
  solverRuntimeStatus: SolverRuntimeStatus;
  lastHeartbeatAt: number | null;
  settledVolume: bigint;
  feesEarned: bigint;
  successfulFillCount: number;
  averageSettlementSeconds: number;
  availableLiquidity: bigint;
  outstandingExposure: bigint;
  utilisationBps: number;
  /** Owner controls are only rendered for capabilities the deployed ABI exposes. */
  capabilities: {
    pause: boolean;
    revokeSolver: boolean;
    replaceSolver: boolean;
  };
}

export type ActivityOutcome = "LOST_RACE" | "REVERTED" | "REJECTED_BY_POLICY" | "EXPIRED";

export interface ActivityRow {
  intentId: Hex;
  sourceChainId: number;
  destinationChainId: number;
  amount: bigint;
  outcome: ActivityOutcome;
  detail: string;
  at: number;
  txHash: Hex | null;
}
