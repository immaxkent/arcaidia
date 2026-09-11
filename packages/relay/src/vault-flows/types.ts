/**
 * Mirrors `substreams/erc4626-vault-flows/proto/erc4626/v1/erc4626.proto`'s
 * `Deposit`/`Withdraw` exactly (field-for-field), decoded from the module's
 * own protobuf-JSON output shape (`{ bytes: "0x..." }` for a `BigInt`, camelCase
 * field names) into native TS values. This module is deliberately generic —
 * it carries no Arcaidia-specific field, watches every conforming vault, not
 * an allowlisted one — see that proto file's own doc comment.
 */
export interface VaultFlowDeposit {
  readonly kind: 'DEPOSIT';
  readonly vault: `0x${string}`;
  readonly sender: `0x${string}`;
  readonly owner: `0x${string}`;
  readonly assets: bigint;
  readonly shares: bigint;
  readonly txHash: `0x${string}`;
  readonly blockNumber: number;
  readonly blockTimestamp: number;
  readonly logIndex: number;
}

export interface VaultFlowWithdraw {
  readonly kind: 'WITHDRAW';
  readonly vault: `0x${string}`;
  readonly sender: `0x${string}`;
  readonly receiver: `0x${string}`;
  readonly owner: `0x${string}`;
  readonly assets: bigint;
  readonly shares: bigint;
  readonly txHash: `0x${string}`;
  readonly blockNumber: number;
  readonly blockTimestamp: number;
  readonly logIndex: number;
}

export type VaultFlowEvent = VaultFlowDeposit | VaultFlowWithdraw;

/**
 * Where a batch of decoded flow events comes from — kept as a narrow port
 * (same reasoning as `@arcaidia/domain`'s `ObservationProvider`/
 * `SettlementAdapter`) so the Relay's filtering/API logic (WP-21.3/21.4)
 * never has to know or care whether it's reading a committed fixture or a
 * live Substreams gRPC subscription: swapping one for the other, later,
 * touches no caller.
 */
export interface VaultFlowSource {
  readVaultFlows(): Promise<readonly VaultFlowEvent[]>;
}
