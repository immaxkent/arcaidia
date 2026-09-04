/**
 * Typed errors. Every rejection an agent, adapter or UI can surface has a code
 * here, so failures render as causes rather than stack traces.
 */

export const ErrorCode = {
  // Configuration
  CHAIN_NOT_CONFIGURED: 'CHAIN_NOT_CONFIGURED',
  ROUTE_NOT_SUPPORTED: 'ROUTE_NOT_SUPPORTED',
  SAME_CHAIN_ROUTE: 'SAME_CHAIN_ROUTE',
  INVALID_CHAIN_CONFIG: 'INVALID_CHAIN_CONFIG',
  // Intent construction
  INVALID_INTENT: 'INVALID_INTENT',
  ASSET_NOT_ALLOWLISTED: 'ASSET_NOT_ALLOWLISTED',
  DEADLINE_IN_PAST: 'DEADLINE_IN_PAST',
  FEE_CEILING_EXCEEDED: 'FEE_CEILING_EXCEEDED',
  // Source verification
  SOURCE_TX_NOT_FOUND: 'SOURCE_TX_NOT_FOUND',
  SOURCE_TX_REVERTED: 'SOURCE_TX_REVERTED',
  SOURCE_ROUTER_MISMATCH: 'SOURCE_ROUTER_MISMATCH',
  INTENT_EVENT_MISSING: 'INTENT_EVENT_MISSING',
  INTENT_FIELDS_MISMATCH: 'INTENT_FIELDS_MISMATCH',
  SETTLEMENT_NOT_INITIATED: 'SETTLEMENT_NOT_INITIATED',
  INSUFFICIENT_CONFIRMATIONS: 'INSUFFICIENT_CONFIRMATIONS',
  ALREADY_FILLED: 'ALREADY_FILLED',
  // Authorization
  AUTHORIZATION_EXPIRED: 'AUTHORIZATION_EXPIRED',
  SIGNER_NOT_AUTHORISED: 'SIGNER_NOT_AUTHORISED',
  NONCE_ALREADY_USED: 'NONCE_ALREADY_USED',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  // Vault / liquidity
  VAULT_PAUSED: 'VAULT_PAUSED',
  INSUFFICIENT_LIQUIDITY: 'INSUFFICIENT_LIQUIDITY',
  RESERVE_FLOOR_BREACH: 'RESERVE_FLOOR_BREACH',
  EXPOSURE_CAP_BREACH: 'EXPOSURE_CAP_BREACH',
  INTENT_SIZE_CAP_BREACH: 'INTENT_SIZE_CAP_BREACH',
  // Observation & settlement
  OBSERVATION_UNAVAILABLE: 'OBSERVATION_UNAVAILABLE',
  OBSERVATION_STALE: 'OBSERVATION_STALE',
  SETTLEMENT_TRANSPORT_UNAVAILABLE: 'SETTLEMENT_TRANSPORT_UNAVAILABLE',
  SETTLEMENT_FAILED: 'SETTLEMENT_FAILED',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ArcaidiaError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ArcaidiaError';
    this.code = code;
    this.details = details;
  }
}

export function isArcaidiaError(error: unknown): error is ArcaidiaError {
  return error instanceof ArcaidiaError;
}
