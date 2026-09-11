/**
 * The reference risk policy.
 *
 * Every number here is a decision, not a default. The values are tuned for the
 * hackathon's target networks and are deliberately conservative: this is a
 * disclosed authorised-solver system advancing real capital against a canonical
 * leg that takes minutes.
 *
 * v2 (WP-28): no fee fields. The fee is the vault's posted tier (D7); this
 * policy only decides *whether* to advance, never *at what price*.
 */

import type { RiskPolicy } from '@arcaidia/domain';

const USDC = (whole: number): bigint => BigInt(whole) * 1_000_000n;

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  version: 'v2-testnet-2026-09',

  /** A tenth of the vault is never advanced, so a mispriced fill cannot empty it. */
  reserveFloorBps: 1_000,

  maxFillAmount: USDC(25_000),
  maxOutstandingExposure: USDC(60_000),

  /**
   * Confirmation thresholds (Q9).
   *
   * Deliberately flattened to 1 confirmation at every tier, 2026-09-10, for
   * demo speed — a real reorg-defence trade-off, made knowingly, not a
   * technical limitation: at Sepolia's ~12s block time, "1 confirmation" is
   * itself close to the floor on how fast a fill can be discovered as
   * confirmed at all. The tier *structure* (three amount bands) is kept
   * rather than collapsed to a single flat value, so restoring the original
   * 1/3/6 escalation for larger amounts is a one-line revert, not a redesign.
   */
  confirmationTiers: [
    { upToAmount: USDC(1_000), confirmations: 1 },
    { upToAmount: USDC(10_000), confirmations: 1 },
    { upToAmount: USDC(25_000), confirmations: 1 },
  ],

  settlement: {
    /** Canonical settlement slower than five minutes counts as slowing. */
    slowLatencySeconds: 300,
    slowMaxFillAmount: USDC(5_000),
    /** Stop advancing once this much principal is already awaiting reimbursement. */
    backlogRejectValue: USDC(45_000),
    /** Or once the oldest unreimbursed advance is twenty minutes old. */
    maxOldestUnsettledAgeSeconds: 1_200,
  },

  /** Observations older than a minute are refused as a basis for risking capital. */
  maxObservationAgeSeconds: 60,
};
