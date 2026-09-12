/**
 * The protocol's own history, read from its events on chain — no indexer in the loop.
 *
 * This is the source of truth the indexer only mirrors: every vault label, every authorised
 * signer, every intent, fast fill and canonical settlement is an event one of the five v2
 * contracts emitted. The hooks read the shared indexer first where it exists (it joins and
 * aggregates cheaply) and fall back to these reads when it is missing, stale or mid-re-seed,
 * so nothing on the site goes dark because a third-party indexer is behind the chain.
 *
 * Cost: `eth_getLogs` over the v2 deployment's own block range on a public RPC, plus one
 * `eth_getBlockByNumber` per distinct block for timestamps (cached). Row caps keep a busy
 * testnet from turning a poll into hundreds of block reads.
 */
import { getAbiItem, type AbiEvent } from "viem";
import { ABIS } from "@arcaidia/domain";
import { intentRouterAbi, solverVaultAbi, vaultFactoryAbi } from "./abis";
import { blockTimestamps, readLogsSince, type ChainLog } from "./chain-logs";
import { chainConfig } from "./config";
import type { Address, CanonicalOutcome, Hex, Intent } from "./types";
import { publicClientFor } from "./viem-clients";

const VAULT_CREATED = getAbiItem({ abi: vaultFactoryAbi, name: "VaultCreated" }) as AbiEvent;
const AUTHORISED_SIGNER_SET = getAbiItem({ abi: solverVaultAbi, name: "AuthorisedSignerSet" }) as AbiEvent;
const INTENT_CREATED = getAbiItem({ abi: intentRouterAbi, name: "IntentCreated" }) as AbiEvent;
const FAST_FILLED = getAbiItem({ abi: solverVaultAbi, name: "FastFilled" }) as AbiEvent;
const LP_REIMBURSED = getAbiItem({ abi: ABIS.SettlementReceiver, name: "LpReimbursed" }) as AbiEvent;
const RECIPIENT_PAID_BY_FALLBACK = getAbiItem({ abi: ABIS.SettlementReceiver, name: "RecipientPaidByFallback" }) as AbiEvent;
const HELD_FOR_VAULT = getAbiItem({ abi: ABIS.SettlementReceiver, name: "HeldForVault" }) as AbiEvent;

/** Newest-first row cap for the list-shaped reads — the same cap the indexer queries use. */
export const CHAIN_HISTORY_LIMIT = 200;

function ready(chainId: number) {
  const config = chainConfig(chainId);
  const client = publicClientFor(chainId);
  if (!config || !client) return null;
  return { config, client };
}

// ---------------------------------------------------------------------------------------------
// Vaults

export interface ChainVaultLabel {
  readonly vault: Address;
  readonly owner: Address;
  readonly label: string;
  readonly createdAtBlock: bigint;
}

/** The creator's label for every factory vault — it lives in `VaultCreated`, not in storage. */
export async function vaultLabelsFromChain(chainId: number): Promise<Map<string, ChainVaultLabel>> {
  const r = ready(chainId);
  const out = new Map<string, ChainVaultLabel>();
  if (!r || !r.config.vaultFactory) return out;
  const logs = await readLogsSince<{ vault: Address; owner: Address; label: string }>(
    r.client,
    { address: r.config.vaultFactory, event: VAULT_CREATED },
    r.config.startBlock,
  );
  for (const log of logs) {
    out.set(log.args.vault.toLowerCase(), {
      vault: log.args.vault,
      owner: log.args.owner,
      label: log.args.label,
      createdAtBlock: log.blockNumber,
    });
  }
  return out;
}

/** Every vault the factory has created, in creation order (`vaultCount` / `vaults(i)`). */
export async function factoryVaultsFromChain(chainId: number): Promise<Address[]> {
  const r = ready(chainId);
  if (!r || !r.config.vaultFactory) return [];
  const factory = r.config.vaultFactory;
  const count = (await r.client.readContract({ address: factory, abi: vaultFactoryAbi, functionName: "vaultCount" })) as bigint;
  return Promise.all(
    Array.from({ length: Number(count) }, (_, i) =>
      r.client.readContract({ address: factory, abi: vaultFactoryAbi, functionName: "vaults", args: [BigInt(i)] }) as Promise<Address>,
    ),
  );
}

/**
 * The signers a vault currently authorises, replayed from its `AuthorisedSignerSet` history —
 * most recently granted first. The vault only exposes `isAuthorisedSigner(address)`, so this
 * is the one way to learn *which* address to ask about without being told.
 */
export async function authorisedSignersFromChain(chainId: number, vault: Address): Promise<Address[]> {
  const r = ready(chainId);
  if (!r) return [];
  const logs = await readLogsSince<{ signer: Address; allowed: boolean }>(
    r.client,
    { address: vault, event: AUTHORISED_SIGNER_SET },
    r.config.startBlock,
  );
  const granted = new Map<string, Address>();
  for (const log of logs) {
    const key = log.args.signer.toLowerCase();
    granted.delete(key);
    if (log.args.allowed) granted.set(key, log.args.signer);
  }
  return [...granted.values()].reverse();
}

// ---------------------------------------------------------------------------------------------
// Intents

export interface ChainIntent extends Intent {
  readonly blockNumber: bigint;
}

interface IntentCreatedArgs {
  intentId: Hex;
  sender: Address;
  recipient: Address;
  intentVersion: number;
  inputToken: Address;
  amount: bigint;
  sourceChainId: bigint;
  destinationChainId: bigint;
  maxFeeBps: number;
  deadline: bigint;
  nonce: bigint;
  tokenOut: Address;
  targetMinOut: bigint;
  settlementRef: Hex;
}

/**
 * Intents created through this chain's router, newest first, capped at `CHAIN_HISTORY_LIMIT`.
 * `sender` and `intentIds` are indexed on the event, so both filters run in the RPC.
 */
export async function intentsFromChain(
  chainId: number,
  filter: { sender?: Address | null; intentIds?: readonly Hex[] } = {},
): Promise<ChainIntent[]> {
  const r = ready(chainId);
  if (!r || !r.config.intentRouter) return [];
  if (filter.intentIds && filter.intentIds.length === 0) return [];
  const args: Record<string, unknown> = {
    ...(filter.sender ? { sender: filter.sender } : {}),
    ...(filter.intentIds ? { intentId: [...filter.intentIds] } : {}),
  };
  const logs = await readLogsSince<IntentCreatedArgs>(
    r.client,
    { address: r.config.intentRouter, event: INTENT_CREATED, ...(Object.keys(args).length ? { args } : {}) },
    r.config.startBlock,
  );
  const newest = logs.slice(-CHAIN_HISTORY_LIMIT).reverse();
  const timestamps = await blockTimestamps(r.client, chainId, newest.map((l) => l.blockNumber));
  return newest.map((log) => ({
    intentId: log.args.intentId,
    intentVersion: Number(log.args.intentVersion),
    sender: log.args.sender,
    recipient: log.args.recipient,
    inputToken: log.args.inputToken,
    amount: log.args.amount,
    sourceChainId: Number(log.args.sourceChainId),
    destinationChainId: Number(log.args.destinationChainId),
    maxFeeBps: Number(log.args.maxFeeBps),
    deadline: Number(log.args.deadline),
    tokenOut: log.args.tokenOut,
    targetMinOut: log.args.targetMinOut,
    createdAt: timestamps.get(log.blockNumber) ?? 0,
    sourceTxHash: log.transactionHash,
    blockNumber: log.blockNumber,
  }));
}

// ---------------------------------------------------------------------------------------------
// Fills

export interface ChainFill {
  readonly intentId: Hex;
  /** The vault that won — the event's emitter. */
  readonly vault: Address;
  readonly recipient: Address;
  readonly signer: Address;
  readonly inputAmount: bigint;
  readonly outputAmount: bigint;
  readonly feeAmount: bigint;
  readonly feeBps: number;
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly timestamp: number;
}

interface FastFilledArgs {
  intentId: Hex;
  recipient: Address;
  signer: Address;
  inputAmount: bigint;
  outputAmount: bigint;
  feeAmount: bigint;
  feeBps: number;
}

/**
 * Winning fast fills on this chain, newest first. `vaults` narrows to specific vaults (one
 * vault's own fills); omitted, every factory vault is read in one call. `intentIds` narrows to
 * the fills for known intents (the history join).
 */
export async function fillsFromChain(
  chainId: number,
  filter: { vaults?: readonly Address[]; intentIds?: readonly Hex[] } = {},
): Promise<ChainFill[]> {
  const r = ready(chainId);
  if (!r) return [];
  if (filter.intentIds && filter.intentIds.length === 0) return [];
  const vaults = filter.vaults ?? (await factoryVaultsFromChain(chainId));
  if (vaults.length === 0) return [];
  const logs = await readLogsSince<FastFilledArgs>(
    r.client,
    {
      address: vaults,
      event: FAST_FILLED,
      ...(filter.intentIds ? { args: { intentId: [...filter.intentIds] } } : {}),
    },
    r.config.startBlock,
  );
  const newest = logs.slice(-CHAIN_HISTORY_LIMIT).reverse();
  const timestamps = await blockTimestamps(r.client, chainId, newest.map((l) => l.blockNumber));
  return newest.map((log) => ({
    intentId: log.args.intentId,
    vault: log.address,
    recipient: log.args.recipient,
    signer: log.args.signer,
    inputAmount: log.args.inputAmount,
    outputAmount: log.args.outputAmount,
    feeAmount: log.args.feeAmount,
    feeBps: Number(log.args.feeBps),
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    timestamp: timestamps.get(log.blockNumber) ?? 0,
  }));
}

// ---------------------------------------------------------------------------------------------
// Settlements

export interface ChainSettlement {
  readonly intentId: Hex;
  readonly outcome: CanonicalOutcome;
  readonly amount: bigint;
  readonly txHash: Hex;
  readonly timestamp: number;
}

/**
 * Canonical settlements recorded by this chain's receiver for the given intents — one of the
 * three outcome events, whichever path (proof or reporter) recorded it.
 */
export async function settlementsFromChain(chainId: number, intentIds: readonly Hex[]): Promise<ChainSettlement[]> {
  const r = ready(chainId);
  if (!r || !r.config.settlementReceiver || intentIds.length === 0) return [];
  const receiver = r.config.settlementReceiver;
  const args = { intentId: [...intentIds] };
  const [reimbursed, fallback, held] = await Promise.all([
    readLogsSince<{ intentId: Hex; amount: bigint }>(r.client, { address: receiver, event: LP_REIMBURSED, args }, r.config.startBlock),
    readLogsSince<{ intentId: Hex; amount: bigint }>(r.client, { address: receiver, event: RECIPIENT_PAID_BY_FALLBACK, args }, r.config.startBlock),
    readLogsSince<{ intentId: Hex; amount: bigint }>(r.client, { address: receiver, event: HELD_FOR_VAULT, args }, r.config.startBlock),
  ]);
  const tagged: Array<[CanonicalOutcome, ChainLog<{ intentId: Hex; amount: bigint }>]> = [
    ...reimbursed.map((l) => ["LP_REIMBURSED", l] as [CanonicalOutcome, typeof l]),
    ...fallback.map((l) => ["RECIPIENT_FALLBACK", l] as [CanonicalOutcome, typeof l]),
    ...held.map((l) => ["HELD_FOR_VAULT", l] as [CanonicalOutcome, typeof l]),
  ];
  const timestamps = await blockTimestamps(r.client, chainId, tagged.map(([, l]) => l.blockNumber));
  return tagged.map(([outcome, log]) => ({
    intentId: log.args.intentId,
    outcome,
    amount: log.args.amount,
    txHash: log.transactionHash,
    timestamp: timestamps.get(log.blockNumber) ?? 0,
  }));
}
