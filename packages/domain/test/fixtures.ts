import {
  INTENT_VERSION,
  USDC_TOKEN_OUT,
  type Address,
  type FeePolicy,
  type FillAuthorization,
  type IntentParams,
} from '../src/index.js';

export const ALICE: Address = '0x1111111111111111111111111111111111111111';
export const BOB: Address = '0x2222222222222222222222222222222222222222';
export const MOCK_ETH: Address = '0x3333333333333333333333333333333333333333';
export const VAULT_A: Address = '0xAAaA000000000000000000000000000000000001';
export const VAULT_B: Address = '0xBbbb000000000000000000000000000000000002';

export const SEPOLIA = 11155111;
export const ARC = 5042002;

const UINT256_MAX = (1n << 256n) - 1n;

/**
 * Vector 1 — a plain USDC transfer. Shared literal-for-literal with
 * `contracts/test/IntentId.t.sol`; both suites assert `VECTORS.usdcOnly`.
 */
export const baseIntent: IntentParams = {
  intentVersion: INTENT_VERSION,
  sender: ALICE,
  recipient: BOB,
  inputToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  amount: 1_000_000_000n, // 1,000 USDC at 6 decimals
  sourceChainId: SEPOLIA,
  destinationChainId: ARC,
  maxFeeBps: 30,
  deadline: 1_800_000_000,
  nonce: 7n,
  tokenOut: USDC_TOKEN_OUT,
  targetMinOut: 0n,
};

/** Vector 2 — the same transfer as a trade intent: 0.25 MockETH minimum out. */
export const tradeIntent: IntentParams = {
  ...baseIntent,
  tokenOut: MOCK_ETH,
  targetMinOut: 250_000_000_000_000_000n,
};

/** Vector 3 — the same transfer in the opposite direction: two fields swapped, nothing else. */
export const mirroredIntent: IntentParams = {
  ...baseIntent,
  sourceChainId: ARC,
  destinationChainId: SEPOLIA,
};

/** Vector 4 — every width-sensitive field at its maximum, proving the uint widths both sides encode. */
export const maxWidthIntent: IntentParams = {
  ...baseIntent,
  amount: UINT256_MAX,
  nonce: UINT256_MAX,
  tokenOut: MOCK_ETH,
  targetMinOut: UINT256_MAX,
  maxFeeBps: 10_000,
  deadline: Number.MAX_SAFE_INTEGER,
};

/** The expected ids. Change one of these only together with `IntentId.t.sol`. */
export const VECTORS = {
  typehash: '0x2c6674d90e5d54fba3347fed0eff5641e7395a761cecbf27dfe3d41b36fa413e',
  usdcOnly: '0x96a1a2a472816b5990818f5a89d5361bf32bf255bcad23bf64f22e7237948058',
  trade: '0xa8d935eff12a337ede5edcee94b93b4a9e756b9a905b1e36bbd034cdf0847f69',
  mirrored: '0xb6997a5c7162d9164d132aaa1880e73da582684ff1fbe10ee3b8875e084d1cf2',
  maxWidth: '0x68544c72f88d746145b4da20edb9affbd08cee1680c9b93f442d20ecd3461e39',
} as const;

export const baseAuthorization: FillAuthorization = {
  intentId: '0x1234567890123456789012345678901234567890123456789012345678901234',
  sourceChainId: SEPOLIA,
  sourceTxHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  recipient: BOB,
  inputAmount: 1_000_000_000n,
  outputAmount: 999_000_000n,
  feeAmount: 1_000_000n,
  expiry: 1_800_000_060,
  nonce: 1n,
};

/** Shared with `contracts/test/FeePolicyLib.t.sol`. */
export const baseFeePolicy: FeePolicy = {
  baseFeeBps: 10,
  midFeeBps: 25,
  highFeeBps: 60,
  criticalFeeBps: 120,
  midThresholdBps: 5_000,
  highThresholdBps: 7_500,
  criticalThresholdBps: 9_000,
};
