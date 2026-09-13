import { describe, expect, it } from 'vitest';
import { PRICED_ENDPOINTS, formatHbar, pricingDirectory } from '../src/pricing.js';
import { routesConfig } from '../src/server.js';

describe('pricing', () => {
  it('formats tinybar as HBAR', () => {
    expect(formatHbar(1_000_000n)).toBe('0.01 HBAR');
    expect(formatHbar(100_000_000n)).toBe('1 HBAR');
    expect(formatHbar(250_000_000n)).toBe('2.5 HBAR');
  });

  it('publishes every priced route in the free directory with the same price the paywall charges', () => {
    const directory = pricingDirectory('0.0.42', 'https://api.testnet.blocky402.com');
    const routes = routesConfig('0.0.42') as Record<string, { accepts: { price: { amount: string }; payTo: string } }>;
    expect(directory.endpoints).toHaveLength(PRICED_ENDPOINTS.length);
    for (const endpoint of directory.endpoints) {
      const route = routes[`GET ${endpoint.path}`];
      expect(route, endpoint.path).toBeDefined();
      expect(route!.accepts.price.amount).toBe(endpoint.price.tinybar);
      expect(route!.accepts.payTo).toBe('0.0.42');
    }
    expect(directory.network).toBe('hedera:testnet');
    expect(directory.asset).toBe('0.0.0');
  });
});
