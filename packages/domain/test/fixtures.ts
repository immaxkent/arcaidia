import type { Address, FillAuthorization, IntentParams } from '../src/index.js';

export const ALICE: Address = '0x1111111111111111111111111111111111111111';
export const BOB: Address = '0x2222222222222222222222222222222222222222';
export const VAULT_A: Address = '0xAAaA000000000000000000000000000000000001';
export const VAULT_B: Address = '0xBbbb000000000000000000000000000000000002';

export const SEPOLIA = 11155111;
export const ARC = 5042002;

export const baseIntent: IntentParams = {
  sender: ALICE,
  recipient: BOB,
  inputToken: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  amount: 1_000_000_000n, // 1,000 USDC at 6 decimals
  sourceChainId: SEPOLIA,
  destinationChainId: ARC,
  maxFeeBps: 30,
  deadline: 1_800_000_000,
  nonce: 7n,
};

/** The same transfer in the opposite direction: two fields swapped, nothing else. */
export const mirroredIntent: IntentParams = {
  ...baseIntent,
  sourceChainId: ARC,
  destinationChainId: SEPOLIA,
};

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
