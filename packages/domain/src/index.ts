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

// Intent
export type { Intent, IntentParams } from './types/intent.js';

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
export { SettlementStatus, ACTIVE_SETTLEMENT_STATUSES, availableLiquidity, utilisationBps } from './types/settlement.js';
export type {
  SettlementReference,
  SettlementState,
  SettlementHealth,
  VaultState,
} from './types/settlement.js';

// Configuration — the only place a chain-specific value may live
export { CHAINS, CHAIN_KEYS, CREATE2_FACTORY, findChain, isSupportedRoute, supportedRoutes } from './config/chains.js';
export type {
  ChainConfig,
  ChainKey,
  TokenConfig,
  SettlementTransportConfig,
  ProtocolContracts,
  Route,
} from './config/chains.js';
export { resolveRoute, resolveEndpoints } from './config/routes.js';

// Encodings
export { computeIntentId, INTENT_TYPEHASH } from './intent-id.js';
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
  SigningAuthority,
  ExecutingAuthority,
  SettlementAdapter,
} from './ports.js';

// Errors
export { ArcaidiaError, ErrorCode, isArcaidiaError } from './errors.js';

// ABIs (populated by WP-01)
export { ABIS } from './abis.js';
