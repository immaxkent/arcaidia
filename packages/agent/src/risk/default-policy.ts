/**
 * The V1 demo risk policy.
 *
 * Every number here is a decision, not a default. The values are tuned for the
 * hackathon's target networks and are deliberately conservative: this is a
 * disclosed authorised-solver system advancing real capital against a canonical
 * leg that takes minutes.
 */

import type { RiskPolicy } from '@arcaidia/domain';

const USDC = (whole: number): bigint => BigInt(whole) * 1_000_000n;

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  version: 'v1-testnet-2026-09',

  /** A tenth of the vault is never advanced, so a mispriced fill cannot empty it. */
  reserveFloorBps: 1_000,

  maxFillAmount: USDC(25_000),
  maxOutstandingExposure: USDC(60_000),

  /** 10 bps floor, 100 bps protocol ceiling. */
  baseFeeBps: 10,
  maxFeeBps: 100,

  /**
   * Fee rises with utilisation: the more LP capital is already advanced, the
   * more the next advance costs, because it consumes the last of the buffer.
   */
  utilisationFeeCurve: [
    { atUtilisationBps: 2_500, feeBps: 20 },
    { atUtilisationBps: 5_000, feeBps: 35 },
    { atUtilisationBps: 7_500, feeBps: 60 },
  ],

  /**
   * Confirmation thresholds (Q9).
   *
   * Ethereum Sepolia produces blocks roughly every 12 seconds, and Circle's
   * Standard Transfer waits for finality regardless — so these thresholds cost
   * the user seconds while the canonical leg costs minutes. They are low enough
   * to demo and high enough to be a real reorg defence at these sizes; the
   * README states them explicitly rather than leaving the number implied.
   */
  confirmationTiers: [
    { upToAmount: USDC(1_000), confirmations: 1 },
    { upToAmount: USDC(10_000), confirmations: 3 },
    { upToAmount: USDC(25_000), confirmations: 6 },
  ],

  settlement: {
    /** Canonical settlement slower than five minutes counts as slowing. */
    slowLatencySeconds: 300,
    slowFeeSurchargeBps: 25,
    slowMaxFillAmount: USDC(5_000),
    /** Stop advancing once this much principal is already awaiting reimbursement. */
    backlogRejectValue: USDC(45_000),
    /** Or once the oldest unreimbursed advance is twenty minutes old. */
    maxOldestUnsettledAgeSeconds: 1_200,
  },

  /** Observations older than a minute are refused as a basis for risking capital. */
  maxObservationAgeSeconds: 60,
};
