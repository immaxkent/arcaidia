/**
 * Intent creation, quoting and settlement tracking for a single transfer.
 *
 * SOURCE:
 *   quote      -> solver quote / protocol fee configuration (no invented fee) — not yet wired
 *   create     -> wallet-signed IntentRouter.createIntent, then the real receipt
 *                 and the IntentCreated event for the real intentId + tx hash
 *   settlement -> fast-fill event + canonical CCTP settlement state — not yet wired
 *
 * Never synthesise an intent id, tx hash or timestamp. Before an intent exists
 * these stay `unavailable`.
 *
 * `useIntent()` is context-backed (`IntentProvider`) rather than a plain hook:
 * the transfer form that submits and the settlement panel that displays the
 * result are sibling components, and a plain `useState`-backed hook would give
 * each its own independent instance — the created intent would never reach the
 * panel. `IntentProvider` is mounted once, above both, in routes/transfer.tsx.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { decodeEventLog, encodeEventTopics } from "viem";
import { erc20Abi, intentRouterAbi } from "@/lib/arcaidia/abis";
import { useWallet } from "@/components/wallet/wallet-context";
import { chainConfig } from "@/lib/arcaidia/config";
import { readyState, unavailableState, type DataState } from "@/lib/arcaidia/data-state";
import type { Address, AgentDecision, Intent, IntentSettlementState } from "@/lib/arcaidia/types";
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

/** Solver quote for a pending (unsubmitted) transfer. */
export function useIntentQuote(request: IntentRequest | null): DataState<AgentDecision> {
  if (!request) return unavailableState("Enter an amount");
  // TODO(integration): POST to the solver quote endpoint / read protocol fee config.
  return unavailableState("Quote service not connected");
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
        const [intentCreatedTopic] = encodeEventTopics({ abi: intentRouterAbi, eventName: "IntentCreated" });
        const log = receipt.logs.find(
          (l) => l.address.toLowerCase() === intentRouter.toLowerCase() && l.topics[0] === intentCreatedTopic,
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

/** Both settlement facts for an intent, tracked separately. */
export function useIntentSettlement(intentId: string | null): DataState<IntentSettlementState> {
  if (!intentId) return unavailableState("No intent yet");
  // TODO(integration): fast-fill event + canonical settlement from chain/The Graph.
  return unavailableState("Settlement source not connected");
}
