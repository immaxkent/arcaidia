/**
 * @arcaidia/domain — the shared vocabulary of the protocol.
 *
 * Every other package imports its types, its chain configuration and its
 * encodings from here. Nothing here knows about Circle, Privy, The Graph or any
 * particular chain beyond what `config/chains.ts` declares as data.
 */

// Primitives
export type { Address, Hex, TxHash, Bytes32, UnixSeconds, Bps } from './types/primitives.js';
export { BPS_DENOMINATOR } from './types/primitives.js';

// Dual settlement state — two axes, never merged
export {
  FastStatus,
  CanonicalStatus,
  CanonicalOutcome,
  describeSettlementState,
  isRecipientPaid,
  isCanonicallyFinal,
  isLpExposed,
} from './types/status.js';
export type { IntentSettlementState } from './types/status.js';

// Intent — schema v1.1 (D5)
export type { Intent, IntentParams } from './types/intent.js';
export { INTENT_VERSION, USDC_TOKEN_OUT, LEGACY_V1_INTENT_FIELDS, isTradeIntent } from './types/intent.js';

// Vault fee policy (D7)
export { MAX_FEE_BPS, feeBpsAt, feePolicyAmountFor, validateFeePolicy, InvalidFeePolicyError } from './fee-policy.js';
export type { FeePolicy } from './fee-policy.js';

// Ecosystem intelligence (WP-33/35)
export type { EcosystemIntelligence, VaultFeeSnapshot, LatencyPercentiles } from './types/intelligence.js';

// Fill authorization
export type { FillAuthorization, SignedFillAuthorization } from './types/fill.js';

// Agent decisions
export { Verdict, DecisionReason } from './types/decision.js';
export type { AgentDecision, DecisionInputs } from './types/decision.js';

// Risk policy
export type {
  RiskPolicy,
  SettlementRiskPolicy,
  FeeCurvePoint,
  ConfirmationTier,
} from './types/risk.js';

// Settlement and vault state
export {
  SettlementStatus,
  ACTIVE_SETTLEMENT_STATUSES,
  availableLiquidity,
  lpLiquidBalance,
  totalAssets,
  utilisationBps,
} from './types/settlement.js';
export type {
  SettlementReference,
  SettlementState,
  SettlementHealth,
  VaultState,
} from './types/settlement.js';

// Configuration — the only place a chain-specific value may live
export {
  CHAINS,
  CHAIN_KEYS,
  CREATE2_FACTORY,
  chainConfig,
  findChain,
  isSupportedRoute,
  supportedRoutes,
} from './config/chains.js';
export type {
  ChainConfig,
  ChainKey,
  TokenConfig,
  SettlementTransportConfig,
  ProtocolContracts,
  Route,
} from './config/chains.js';
export { resolveRoute, resolveEndpoints } from './config/routes.js';
export { SWAP_INFRASTRUCTURE, marketsFor } from './config/markets.js';
export type { DestinationMarket, SwapInfrastructure } from './config/markets.js';

// Encodings
export { computeIntentId, INTENT_TYPEHASH } from './intent-id.js';
export {
  HOOK_VERSION,
  HOOK_LENGTH_BYTES,
  encodeIntentHook,
  decodeIntentHook,
  MalformedIntentHookError,
} from './intent-hook.js';
export type { IntentHook } from './intent-hook.js';
export {
  FILL_AUTHORIZATION_TYPES,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  buildEip712Domain,
  fillAuthorizationTypedData,
  hashFillAuthorization,
} from './eip712.js';
export type { FillAuthorizationDomain } from './eip712.js';

// Adapter boundaries
export type {
  ObservationProvider,
  AgentAuthority,
  SettlementAdapter,
  SwapAdapter,
  IntelligenceProvider,
} from './ports.js';

// Errors
export { ArcaidiaError, ErrorCode, isArcaidiaError } from './errors.js';

// ABIs — generated from the Foundry build
export { ABIS } from './abis.js';
export type { ArcaidiaAbis } from './abis.js';

// Deployed addresses — written by the deployment script
export {
  DEPLOYMENTS,
  PROTOCOL_CONTRACT_NAMES,
  deployedAddresses,
  registerDeployment,
  resetDeployments,
  deploymentFor,
  registerChainOverride,
  chainOverrideFor,
} from './config/deployments.js';
export type {
  ProtocolContractName,
  DeployedAddress,
  ChainOverride,
} from './config/deployments.js';
