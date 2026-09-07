/**
 * Intent creation, quoting and settlement tracking for a single transfer.
 *
 * WIRE:
 *   quote      -> solver quote / protocol fee configuration (no invented fee)
 *   create     -> Privy-signed IntentRouter.createIntent, then the real receipt
 *                 and the IntentCreated event for the real intentId + tx hash
 *   settlement -> fast-fill event + canonical CCTP settlement state
 *
 * Never synthesise an intent id, tx hash or timestamp. Before an intent exists
 * these stay `unavailable`.
 */
import { useCallback, useState } from "react";
import { chainConfig } from "@/lib/arcaidia/config";
import {
  unavailableState,
  type DataState,
} from "@/lib/arcaidia/data-state";
import type { AgentDecision, Intent, IntentSettlementState } from "@/lib/arcaidia/types";

export interface IntentRequest {
  sourceChainId: number;
  destinationChainId: number;
  amount: bigint;
  recipient: string;
  maxFeeBps: number;
  deadlineSeconds: number;
}

/** Solver quote for a pending (unsubmitted) transfer. */
export function useIntentQuote(request: IntentRequest | null): DataState<AgentDecision> {
  if (!request) return unavailableState("Enter an amount");
  // TODO(integration): POST to the solver quote endpoint / read protocol fee config.
  return unavailableState("Quote service not connected");
}

/** The intent created by the current session, once it actually exists onchain. */
export function useIntent(): {
  state: DataState<Intent>;
  submitting: boolean;
  submitError: string | null;
  createIntent: (request: IntentRequest) => Promise<void>;
} {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createIntent = useCallback(async (request: IntentRequest) => {
    const config = chainConfig(request.sourceChainId);
    setSubmitError(null);
    if (!config?.intentRouter) {
      setSubmitError("IntentRouter is not deployed/configured for this chain yet.");
      return;
    }
    setSubmitting(true);
    try {
      // TODO(integration): approve if needed, then Privy-signed createIntent,
      // wait for the receipt and decode IntentCreated for the real intentId.
      setSubmitError("Transaction signing is not connected yet.");
    } finally {
      setSubmitting(false);
    }
  }, []);

  return {
    state: unavailableState("No intent submitted yet"),
    submitting,
    submitError,
    createIntent,
  };
}

/** Both settlement facts for an intent, tracked separately. */
export function useIntentSettlement(intentId: string | null): DataState<IntentSettlementState> {
  if (!intentId) return unavailableState("No intent yet");
  // TODO(integration): fast-fill event + canonical settlement from chain/The Graph.
  return unavailableState("Settlement source not connected");
}
