/**
 * All Relay state, in memory, per `{chainId, vaultAddress}`.
 *
 * No custody, no execution authority, nothing here can move funds — this
 * store's entire job is remembering "has this operator proven it holds this
 * key" and "when did we last hear from it," and forwarding pre-chain stages
 * while that holds. If this process disappears, every conforming solver
 * keeps discovering, verifying, deciding, filling and getting reimbursed
 * exactly as WP-17.4's kill-the-Relay test proves — only the console's live
 * view degrades.
 */
import { randomBytes } from 'node:crypto';
import { buildChallengeMessage, verifyChallengeSignature } from './pairing.js';
import {
  TELEMETRY_STAGES,
  initialState,
  vaultKeyToken,
  type TelemetryStage,
  type VaultKey,
  type VaultTelemetryState,
} from './types.js';

const CHALLENGE_TTL_SECONDS = 300;

export interface RelayStoreOptions {
  /** No heartbeat within this window flips a vault to offline. Default 30s. */
  readonly heartbeatTimeoutSeconds?: number;
  /** Injectable for tests; defaults to the real clock. */
  readonly clock?: () => number;
}

interface PendingChallenge {
  readonly message: string;
  readonly operatorAddress: `0x${string}`;
  readonly expiresAt: number;
}

export type StageEventRejection = 'UNACCEPTED_STAGE' | 'NOT_PAIRED';

type Listener = (state: VaultTelemetryState) => void;

export class RelayStore {
  private readonly heartbeatTimeoutSeconds: number;
  private readonly clock: () => number;
  private readonly records = new Map<string, VaultTelemetryState>();
  private readonly pending = new Map<string, PendingChallenge>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(options: RelayStoreOptions = {}) {
    this.heartbeatTimeoutSeconds = options.heartbeatTimeoutSeconds ?? 30;
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
  }

  stateOf(key: VaultKey): VaultTelemetryState {
    return this.records.get(vaultKeyToken(key)) ?? initialState(key);
  }

  /** WP-18.1, step one: issue a fresh, single-use challenge for this vault+operator. */
  issueChallenge(key: VaultKey, operatorAddress: `0x${string}`): { challenge: string; expiresAt: number } {
    const now = this.clock();
    const expiresAt = now + CHALLENGE_TTL_SECONDS;
    const nonce = randomBytes(16).toString('hex');
    const message = buildChallengeMessage({ ...key, operatorAddress, nonce, issuedAt: now, expiresAt });

    this.pending.set(vaultKeyToken(key), {
      message,
      operatorAddress: operatorAddress.toLowerCase() as `0x${string}`,
      expiresAt,
    });

    return { challenge: message, expiresAt };
  }

  /**
   * WP-18.1, step two. Returns false for any mismatch — wrong operator,
   * wrong/expired/unknown challenge, or a signature that doesn't recover to
   * the claimed operator — without distinguishing which, so a failed attempt
   * never leaks which part was wrong.
   */
  async confirmPairing(
    key: VaultKey,
    operatorAddress: `0x${string}`,
    challenge: string,
    signature: `0x${string}`,
  ): Promise<boolean> {
    const token = vaultKeyToken(key);
    const pending = this.pending.get(token);
    if (!pending || pending.message !== challenge) return false;

    if (pending.expiresAt < this.clock()) {
      this.pending.delete(token);
      return false;
    }
    if (pending.operatorAddress !== operatorAddress.toLowerCase()) return false;

    const verified = await verifyChallengeSignature({
      message: challenge,
      signature,
      expectedAddress: operatorAddress,
    });
    if (!verified) return false;

    this.pending.delete(token);
    // Pairing proves key possession, nothing about whether the process is
    // still running a moment later — `online`/`lastHeartbeatAt` stay exactly
    // as they were until a real heartbeat or stage event arrives. This is
    // what lets the console distinguish "AWAITING SOLVER" (paired, never
    // heartbeat) from "SOLVER OFFLINE" (was online, went quiet) — the same
    // two distinct states WP-18.2 names — instead of collapsing them into
    // one boolean the instant pairing completes.
    this.update(key, (state) => ({
      ...state,
      operatorAddress: operatorAddress.toLowerCase() as `0x${string}`,
      paired: true,
    }));
    return true;
  }

  /** WP-18.2. Liveness only — never touches `stage`. */
  recordHeartbeat(key: VaultKey, operatorAddress: `0x${string}`, at?: number): boolean {
    if (!this.isPairedTo(key, operatorAddress)) return false;
    this.update(key, (state) => ({ ...state, online: true, lastHeartbeatAt: at ?? this.clock() }));
    return true;
  }

  /**
   * WP-18.3. Rejects anything outside the four pre-chain stages outright —
   * `TELEMETRY_STAGES` is the single shared list telemetry, the Relay and the
   * agent's own `process-intent.ts` all read, so an onchain-confirmed stage
   * (e.g. a hypothetical `FAST_FILL_CONFIRMED`) can never be accepted from
   * this channel by construction, not by remembering to check a second list.
   *
   * Takes no `operatorAddress`, unlike `recordHeartbeat` — deliberately:
   * `TelemetryStageEvent` (`@arcaidia/telemetry`) doesn't carry one, and it
   * doesn't need to. Pairing is the one place possession of the operator key
   * is actually proven; once a vault is paired, "is this vault currently
   * paired at all" is the only fact an event needs to clear, because there is
   * at most one paired operator per vault (the most recent successful
   * pairing) and nothing downstream trusts a stage event for anything but a
   * cosmetic orb state anyway (WP-17.4's whole point).
   */
  recordStageEvent(
    key: VaultKey,
    stage: string,
    intentId: `0x${string}`,
    at?: number,
  ): { ok: true } | { ok: false; reason: StageEventRejection } {
    if (!TELEMETRY_STAGES.includes(stage as TelemetryStage)) {
      return { ok: false, reason: 'UNACCEPTED_STAGE' };
    }
    if (!this.stateOf(key).paired) {
      return { ok: false, reason: 'NOT_PAIRED' };
    }

    const now = at ?? this.clock();
    this.update(key, (state) => ({
      ...state,
      online: true,
      lastHeartbeatAt: now,
      stage: stage as TelemetryStage,
      stageAt: now,
      intentId,
    }));
    return { ok: true };
  }

  /**
   * WP-18.2's other half. Flips exactly the vaults whose heartbeat has
   * actually timed out, one at a time — never a vault that is merely paired
   * but has never heartbeat at all (that vault is `AWAITING SOLVER`, a
   * different state from a solver that went quiet), and never any vault
   * this sweep didn't find overdue.
   */
  sweepHeartbeats(): void {
    const now = this.clock();
    for (const [token, state] of this.records) {
      if (
        state.paired &&
        state.online &&
        state.lastHeartbeatAt !== null &&
        now - state.lastHeartbeatAt > this.heartbeatTimeoutSeconds
      ) {
        const next: VaultTelemetryState = { ...state, online: false };
        this.records.set(token, next);
        this.emit(token, next);
      }
    }
  }

  /** Scoped to exactly one vault's key by construction — see the doc comment on `emit`. */
  subscribe(key: VaultKey, listener: Listener): () => void {
    const token = vaultKeyToken(key);
    const set = this.listeners.get(token) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(token, set);
    return () => set.delete(listener);
  }

  private isPairedTo(key: VaultKey, operatorAddress: `0x${string}`): boolean {
    const state = this.stateOf(key);
    return state.paired && state.operatorAddress === operatorAddress.toLowerCase();
  }

  private update(key: VaultKey, mutate: (state: VaultTelemetryState) => VaultTelemetryState): void {
    const token = vaultKeyToken(key);
    const next = mutate(this.stateOf(key));
    this.records.set(token, next);
    this.emit(token, next);
  }

  /**
   * Listeners are stored per vault-key token, so a subscriber for one vault
   * structurally cannot receive another vault's update — there is no shared
   * broadcast list this could leak through.
   */
  private emit(token: string, state: VaultTelemetryState): void {
    for (const listener of this.listeners.get(token) ?? []) listener(state);
  }
}
