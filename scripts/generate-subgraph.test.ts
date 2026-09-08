import { afterEach, describe, expect, it } from 'vitest';
import { CHAINS, registerDeployment, resetDeployments } from '../packages/domain/src/index.js';
import { PLACEHOLDER, START_BLOCKS, manifest } from './generate-subgraph.js';

/**
 * `manifest()` is pure (no file I/O), so these exercise it directly against
 * both the real committed deployment record and simulated not-yet-deployed
 * chains, without ever touching the filesystem or the CLI's --check flow.
 */
describe('manifest', () => {
  afterEach(() => resetDeployments());

  it('happy path: a deployed chain gets real addresses, network and start block', () => {
    const yaml = manifest(CHAINS['ethereum-sepolia']);

    expect(yaml).toContain('network: sepolia');
    expect(yaml).toContain(`startBlock: ${START_BLOCKS['ethereum-sepolia']}`);
    expect(yaml).toContain('address: "0x7E4443B9215354e1819ECAA1E4CEDe8A6Fb63357"');
    expect(yaml).toContain('address: "0x9F5813cD0Ea34403f78769076043436E67736da3"');
    expect(yaml).toContain('address: "0xb634d0fDa74BacF730B1eF50a32b4c83f13f11fC"');
    expect(yaml).not.toContain(PLACEHOLDER);
  });

  it('sad path: an undeployed chain falls back to the placeholder address, not a crash', () => {
    registerDeployment('arc-testnet', {});

    const yaml = manifest(CHAINS['arc-testnet']);

    expect(yaml).toContain(`address: "${PLACEHOLDER}"`);
    // The manifest is still well-formed even with nothing deployed: network
    // and start block come from chain config, not from the deployment record.
    expect(yaml).toContain('network: arc-testnet');
    expect(yaml).toContain(`startBlock: ${START_BLOCKS['arc-testnet']}`);
  });

  it('sad path: a partially deployed chain only placeholders the missing contracts', () => {
    registerDeployment('arc-testnet', {
      intentRouter: '0x1111111111111111111111111111111111111111',
      // liquidityVault, settlementReceiver deliberately left unset.
    });

    const yaml = manifest(CHAINS['arc-testnet']);

    expect(yaml).toContain('address: "0x1111111111111111111111111111111111111111"');
    // Two of the three data sources still placeholder; a real bug here would
    // read as "everything indexed" when two contracts are actually missing.
    const placeholderCount = yaml.split(`address: "${PLACEHOLDER}"`).length - 1;
    expect(placeholderCount).toBe(2);
  });

  it('every data source in every chain manifest shares one start block', () => {
    for (const chain of Object.values(CHAINS)) {
      const yaml = manifest(chain);
      const blocks = [...yaml.matchAll(/startBlock: (\d+)/g)].map((m) => m[1]);
      expect(blocks).toHaveLength(3);
      expect(new Set(blocks).size).toBe(1);
    }
  });
});
