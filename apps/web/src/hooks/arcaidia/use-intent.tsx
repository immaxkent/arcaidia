/**
 * Intent creation and quoting for a single transfer.
 *
 * SOURCE:
 *   quote  -> POST SERVICES.solverQuoteUrl + "/quote" (WP-14) — the live
 *             solver's own risk engine, run against real vault state, under
 *             a stated best-case confirmation assumption since nothing has
 *             been submitted yet. An *estimate*, not a binding quote — see
 *             use-intent-quote's own docs.
 *   create -> wallet-signed IntentRouter.createIntent, then the real receipt
 *             and the IntentCreated event for the real intentId + tx hash
 *
 * Settlement tracking (fast-fill + canonical CCTP) for a wallet's transfers,
 * live and historical alike, is useIntentHistory (use-intent-history.ts) —
 * a real subgraph join, rendered by IntentHistoryPanel. This file used to
 * also export a per-session useIntentSettlement for "the one intent I just
 * created," but it never got past a permanent unavailable stub and
 * useIntentHistory already covers the need, so it was removed rather than
 * left as dead placeholder wiring.
 *
 * Never synthesise an intent id, tx hash or timestamp. Before an intent exists
 * these stay `unavailable`.
 *
 * `useIntent()` is context-backed (`IntentProvider`) rather than a plain hook:
 * the transfer form that submits it and any sibling that wants the result
 * would otherwise each get their own independent instance. `IntentProvider`
 * is mounted once, above both, in routes/transfer.tsx.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { decodeEventLog, encodeEventTopics } from "viem";
import { erc20Abi, intentRouterAbi } from "@/lib/arcaidia/abis";
import { useWallet } from "@/components/wallet/wallet-context";
import { chainConfig, SERVICES } from "@/lib/arcaidia/config";
import {
  errorState,
  readyState,
  unavailableState,
  type DataState,
} from "@/lib/arcaidia/data-state";
import type { Address, AgentDecision, Intent } from "@/lib/arcaidia/types";
import { publicClientFor } from "@/lib/arcaidia/viem-clients";
import { viemChainFor } from "@/lib/arcaidia/viem-chains";

export interface IntentRequest {
  sourceChainId: number;
  destinationChainId: number;
  amount: bigint;
  recipient: string;
  maxFeeBps: number;
  deadlineSeconds: number;
}

/** WP-14's `estimatedUnderAssumption` marker, kept off the shared `AgentDecision` shape. */
export interface IntentEstimate extends AgentDecision {
  readonly estimatedUnderAssumption: true;
}

const QUOTE_DEBOUNCE_MS = 400;

/** Bigint fields cross the wire as JSON strings; everything else passes through. */
function parseQuote(raw: Record<string, unknown>): IntentEstimate {
  const inputsUsed = raw["inputsUsed"] as Record<string, unknown>;
  const settlementHealth = inputsUsed["settlementHealth"] as Record<string, unknown>;

  return {
    intentId: raw["intentId"] as Intent["intentId"],
    verdict: raw["verdict"] as AgentDecision["verdict"],
    reason: raw["reason"] as string,
    feeBps: raw["feeBps"] as number,
    feeAmount: BigInt(raw["feeAmount"] as string),
    outputAmount: BigInt(raw["outputAmount"] as string),
    policyVersion: raw["policyVersion"] as string,
    decidedAt: raw["decidedAt"] as number,
    inputsUsed: {
      requestedAmount: BigInt(inputsUsed["requestedAmount"] as string),
      availableLiquidity: BigInt(inputsUsed["availableLiquidity"] as string),
      reserveFloor: BigInt(inputsUsed["reserveFloor"] as string),
      outstandingExposure: BigInt(inputsUsed["outstandingExposure"] as string),
      utilisationBps: inputsUsed["utilisationBps"] as number,
      userMaxFeeBps: inputsUsed["userMaxFeeBps"] as number,
      sourceConfirmations: inputsUsed["sourceConfirmations"] as number,
      requiredConfirmations: inputsUsed["requiredConfirmations"] as number,
      observationAgeSeconds: inputsUsed["observationAgeSeconds"] as number,
      settlementHealth: {
        transport: settlementHealth["transport"] as "HEALTHY" | "DEGRADED" | "UNAVAILABLE",
        oldestUnsettledAgeSeconds: settlementHealth["oldestUnsettledAgeSeconds"] as number | null,
        pendingValue: BigInt(settlementHealth["pendingValue"] as string),
        averageSettlementLatencySeconds: settlementHealth["averageSettlementLatencySeconds"] as
          number | null,
      },
    },
    estimatedUnderAssumption: true,
  };
}

async function fetchQuote(baseUrl: string, request: IntentRequest): Promise<IntentEstimate> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      amount: request.amount.toString(),
      maxFeeBps: request.maxFeeBps,
      sourceChainId: request.sourceChainId,
      destinationChainId: request.destinationChainId,
    }),
  });

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(
      (body?.["error"] as string | undefined) ?? `Quote request failed: ${response.status}`,
    );
  }
  if (!body) throw new Error("Quote endpoint returned no data.");
  return parseQuote(body);
}

/** The same `request`, held back until it has stopped changing for a moment — no request storm while typing. */
function useDebouncedRequest(request: IntentRequest | null): IntentRequest | null {
  const [debounced, setDebounced] = useState(request);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(request), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [request]);

  return debounced;
}

/** Solver quote for a pending (unsubmitted) transfer. An estimate — see this file's docs. */
export function useIntentQuote(request: IntentRequest | null): DataState<AgentDecision> {
  const debounced = useDebouncedRequest(request);
  const quoteUrl = SERVICES.solverQuoteUrl;
  const enabled = Boolean(debounced && quoteUrl && debounced.amount > 0n);

  const query = useQuery({
    queryKey: [
      "intent-quote",
      quoteUrl,
      debounced?.sourceChainId,
      debounced?.destinationChainId,
      debounced?.amount.toString(),
      debounced?.maxFeeBps,
    ],
    queryFn: () => fetchQuote(quoteUrl as string, debounced as IntentRequest),
    enabled,
    staleTime: 5_000,
    retry: false,
  });

  if (!request) return unavailableState("Enter an amount");
  if (!quoteUrl) return unavailableState("Quote service not connected");
  if (query.isError) {
    return errorState(query.error instanceof Error ? query.error.message : "Quote request failed");
  }
  if (!query.data) return unavailableState("Quote service not connected");
  return readyState(query.data);
}

function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return BigInt(`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`);
}

interface IntentValue {
  state: DataState<Intent>;
  submitting: boolean;
  submitError: string | null;
  createIntent: (request: IntentRequest) => Promise<void>;
}

const IntentContext = createContext<IntentValue | null>(null);

export function IntentProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createIntent = useCallback(
    async (request: IntentRequest) => {
      setSubmitError(null);
      const owner = wallet.address;
      if (!owner) {
        setSubmitError("Connect a wallet first.");
        return;
      }
      const config = chainConfig(request.sourceChainId);
      if (!config?.intentRouter) {
        setSubmitError("IntentRouter is not deployed/configured for this chain yet.");
        return;
      }
      if (!config.usdc) {
        setSubmitError("USDC address is not configured for this chain yet.");
        return;
      }
      const publicClient = publicClientFor(request.sourceChainId);
      if (!publicClient) {
        setSubmitError("RPC is not configured for this chain yet.");
        return;
      }

      const { intentRouter, usdc } = config;
      const chain = viemChainFor(request.sourceChainId);

      setSubmitting(true);
      try {
        const walletClient = await wallet.getWalletClient(request.sourceChainId);

        const allowance = await publicClient.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [owner, intentRouter],
        });
        if (allowance < request.amount) {
          const approveHash = await walletClient.writeContract({
            address: usdc,
            abi: erc20Abi,
            functionName: "approve",
            args: [intentRouter, request.amount],
            chain,
            account: owner,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + request.deadlineSeconds);
        const nonce = randomNonce();

        const createHash = await walletClient.writeContract({
          address: intentRouter,
          abi: intentRouterAbi,
          functionName: "createIntent",
          args: [
            request.recipient as Address,
            request.amount,
            BigInt(request.destinationChainId),
            request.maxFeeBps,
            deadline,
            nonce,
          ],
          chain,
          account: owner,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

        // decodeEventLog does not check that a log's topic0 actually matches the
        // requested eventName — filter by the real topic hash first, or a log from
        // an unrelated event on the same tx can be silently misread as IntentCreated.
        const [intentCreatedTopic] = encodeEventTopics({
          abi: intentRouterAbi,
          eventName: "IntentCreated",
        });
        const log = receipt.logs.find(
          (l) =>
            l.address.toLowerCase() === intentRouter.toLowerCase() &&
            l.topics[0] === intentCreatedTopic,
        );
        if (!log) {
          setSubmitError("Transaction confirmed but no IntentCreated event was found.");
          return;
        }
        const decoded = decodeEventLog({
          abi: intentRouterAbi,
          data: log.data,
          topics: log.topics,
          eventName: "IntentCreated",
        });

        setIntent({
          intentId: decoded.args.intentId,
          sender: decoded.args.sender,
          recipient: decoded.args.recipient,
          inputToken: decoded.args.inputToken,
          amount: decoded.args.amount,
          sourceChainId: Number(decoded.args.sourceChainId),
          destinationChainId: Number(decoded.args.destinationChainId),
          maxFeeBps: decoded.args.maxFeeBps,
          deadline: Number(decoded.args.deadline),
          createdAt: Math.floor(Date.now() / 1000),
          sourceTxHash: createHash,
        });
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "Transaction failed.");
      } finally {
        setSubmitting(false);
      }
    },
    [wallet],
  );

  const value = useMemo<IntentValue>(
    () => ({
      state: intent ? readyState(intent) : unavailableState("No intent submitted yet"),
      submitting,
      submitError,
      createIntent,
    }),
    [intent, submitting, submitError, createIntent],
  );

  return <IntentContext.Provider value={value}>{children}</IntentContext.Provider>;
}

/** The intent created by the current session, once it actually exists onchain. */
export function useIntent(): IntentValue {
  const ctx = useContext(IntentContext);
  if (!ctx) throw new Error("useIntent must be used inside IntentProvider");
  return ctx;
}

