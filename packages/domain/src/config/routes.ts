/**
 * Route resolution. The whole of Arcaidia's direction-agnosticism reduces to
 * this function: give it two chain IDs, it hands back the source and destination
 * configurations. Callers use `route.source` and `route.destination` and never
 * learn which chains those are.
 */

import { ArcaidiaError, ErrorCode } from '../errors.js';
import { findChain, type ChainConfig, type Route } from './chains.js';

/**
 * Resolve the endpoints for one transfer.
 *
 * @throws {ArcaidiaError} if either chain is unconfigured or the two are equal.
 */
export function resolveRoute(sourceChainId: number, destinationChainId: number): Route {
  if (sourceChainId === destinationChainId) {
    throw new ArcaidiaError(
      ErrorCode.SAME_CHAIN_ROUTE,
      `Source and destination are the same chain (${sourceChainId}).`,
      { sourceChainId, destinationChainId },
    );
  }

  const source = requireChain(sourceChainId, 'source');
  const destination = requireChain(destinationChainId, 'destination');

  return { source, destination };
}

function requireChain(chainId: number, role: 'source' | 'destination'): ChainConfig {
  const chain = findChain(chainId);
  if (!chain) {
    throw new ArcaidiaError(
      ErrorCode.CHAIN_NOT_CONFIGURED,
      `No configuration for ${role} chain ${chainId}.`,
      { chainId, role },
    );
  }
  return chain;
}

/**
 * The router that holds source funds, and the vault that advances destination
 * liquidity, for a given route. Both are the same contract deployed on both
 * chains; which one acts as which is decided here and nowhere else.
 */
export function resolveEndpoints(route: Route): {
  sourceRouter: `0x${string}`;
  destinationVault: `0x${string}`;
  destinationSettlementReceiver: `0x${string}`;
} {
  const sourceRouter = route.source.contracts.intentRouter;
  const destinationVault = route.destination.contracts.liquidityVault;
  const destinationSettlementReceiver = route.destination.contracts.settlementReceiver;

  if (!sourceRouter || !destinationVault || !destinationSettlementReceiver) {
    throw new ArcaidiaError(
      ErrorCode.INVALID_CHAIN_CONFIG,
      'Protocol contracts are not yet deployed for this route.',
      {
        sourceChainId: route.source.chainId,
        destinationChainId: route.destination.chainId,
        sourceRouter,
        destinationVault,
        destinationSettlementReceiver,
      },
    );
  }

  return { sourceRouter, destinationVault, destinationSettlementReceiver };
}
