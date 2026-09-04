import { describe, expect, it } from 'vitest';
import {
  ArcaidiaError,
  CHAINS,
  ErrorCode,
  findChain,
  isSupportedRoute,
  resolveEndpoints,
  resolveRoute,
  supportedRoutes,
} from '../src/index.js';
import { ARC, SEPOLIA } from './fixtures.js';

describe('resolveRoute', () => {
  it('resolves source and destination from chain ids alone', () => {
    const route = resolveRoute(SEPOLIA, ARC);
    expect(route.source.chainId).toBe(SEPOLIA);
    expect(route.destination.chainId).toBe(ARC);
  });

  it('is symmetric: swapping the arguments mirrors the roles', () => {
    const forward = resolveRoute(SEPOLIA, ARC);
    const reverse = resolveRoute(ARC, SEPOLIA);
    expect(reverse.source).toBe(forward.destination);
    expect(reverse.destination).toBe(forward.source);
  });

  it('rejects a same-chain route', () => {
    expect(() => resolveRoute(SEPOLIA, SEPOLIA)).toThrowError(ArcaidiaError);
    try {
      resolveRoute(SEPOLIA, SEPOLIA);
    } catch (error) {
      expect((error as ArcaidiaError).code).toBe(ErrorCode.SAME_CHAIN_ROUTE);
    }
  });

  it.each([
    ['source', 999999, ARC],
    ['destination', SEPOLIA, 999999],
  ])('rejects an unconfigured %s chain', (_role, source, destination) => {
    try {
      resolveRoute(source, destination);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ArcaidiaError).code).toBe(ErrorCode.CHAIN_NOT_CONFIGURED);
    }
  });
});

describe('supportedRoutes', () => {
  it('includes both directions for every configured pair', () => {
    const routes = supportedRoutes();
    const pairs = routes.map((r) => `${r.source.chainId}->${r.destination.chainId}`);
    expect(pairs).toContain(`${SEPOLIA}->${ARC}`);
    expect(pairs).toContain(`${ARC}->${SEPOLIA}`);
  });

  it('never routes a chain to itself', () => {
    for (const route of supportedRoutes()) {
      expect(route.source.chainId).not.toBe(route.destination.chainId);
    }
  });
});

describe('resolveEndpoints', () => {
  it('refuses to resolve endpoints before the contracts are deployed', () => {
    // WP-01 populates `contracts`. Until then this must fail loudly rather than
    // hand a caller a zero address.
    try {
      resolveEndpoints(resolveRoute(SEPOLIA, ARC));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ArcaidiaError).code).toBe(ErrorCode.INVALID_CHAIN_CONFIG);
    }
  });
});

describe('chain configuration', () => {
  it('is complete for every configured chain', () => {
    for (const chain of Object.values(CHAINS)) {
      expect(chain.chainId).toBeGreaterThan(0);
      expect(chain.rpcUrl).toMatch(/^https?:\/\//);
      expect(chain.explorerUrl).toMatch(/^https:\/\//);
      expect(chain.graphNetwork.length).toBeGreaterThan(0);
      expect(chain.settlementAsset.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(chain.settlementAsset.decimals).toBe(6);
      expect(chain.settlementTransport.domain).toBeGreaterThanOrEqual(0);
      expect(chain.settlementTransport.tokenMessenger).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(chain.settlementTransport.messageTransmitter).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it('gives every chain a distinct settlement-transport domain', () => {
    const domains = Object.values(CHAINS).map((c) => c.settlementTransport.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('uses one deterministic deployment factory across all chains', () => {
    // CREATE2 address parity depends on the same factory existing at the same
    // address on every chain. Verified live on both chains, 2026-09-04.
    const factories = new Set(Object.values(CHAINS).map((c) => c.create2Factory));
    expect(factories.size).toBe(1);
  });

  it('finds chains by id and returns undefined for unknown ones', () => {
    expect(findChain(SEPOLIA)?.key).toBe('ethereum-sepolia');
    expect(findChain(ARC)?.key).toBe('arc-testnet');
    expect(findChain(1234)).toBeUndefined();
  });

  it('reports route support without throwing', () => {
    expect(isSupportedRoute(SEPOLIA, ARC)).toBe(true);
    expect(isSupportedRoute(ARC, SEPOLIA)).toBe(true);
    expect(isSupportedRoute(SEPOLIA, SEPOLIA)).toBe(false);
    expect(isSupportedRoute(SEPOLIA, 999999)).toBe(false);
  });
});
