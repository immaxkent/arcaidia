import { afterEach, describe, expect, it } from 'vitest';
import { CHAINS, registerDeployment, resetDeployments } from '../packages/domain/src/index.js';
import {
  PLACEHOLDER,
  RETIRED_SETTLEMENT_RECEIVER_START_BLOCKS,
  RETIRED_SETTLEMENT_RECEIVERS,
  ROUTER_START_BLOCKS,
  START_BLOCKS,
  manifest,
} from './generate-subgraph.js';

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
    expect(yaml).toContain(`startBlock: ${ROUTER_START_BLOCKS['ethereum-sepolia']}`);
    expect(yaml).toContain(`startBlock: ${START_BLOCKS['ethereum-sepolia']}`);
    // WP-10 redeployed the router (2026-09-09); WP-12 redeployed the vault and
    // receiver a day later (2026-09-10) — different contracts, different times.
    expect(yaml).toContain('address: "0x58868465d14e0694d033bD511588AE90482b21CC"');
    expect(yaml).toContain('address: "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1"');
    expect(yaml).toContain('address: "0x9a47a161ea8328b96Ad976264d42790881570E71"');
    // The receiver WP-12 retired stays indexed too — intents settled before
    // that redeploy must not lose their real settlement history.
    expect(yaml).toContain('name: SettlementReceiverRetired');
    expect(yaml).toContain(`address: "${RETIRED_SETTLEMENT_RECEIVERS['ethereum-sepolia']}"`);
    expect(yaml).not.toContain(PLACEHOLDER);
  });

  it('sad path: an undeployed chain falls back to the placeholder address, not a crash', () => {
    registerDeployment('arc-testnet', {});

    const yaml = manifest(CHAINS['arc-testnet']);

    expect(yaml).toContain(`address: "${PLACEHOLDER}"`);
    // The manifest is still well-formed even with nothing deployed: network
    // and start blocks come from chain config, not from the deployment record.
    expect(yaml).toContain('network: arc-testnet');
    expect(yaml).toContain(`startBlock: ${ROUTER_START_BLOCKS['arc-testnet']}`);
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

  /// Four data sources, four independent start blocks: the router (WP-10,
  /// 2026-09-09), the live vault + receiver pair (WP-12, 2026-09-10, always
  /// identical to each other), and the retired receiver (original
  /// 2026-09-08 deploy, kept indexed permanently). Indexing any of them from
  /// another's block would replay history at an address that did not exist
  /// there yet.
  it('the router, the live vault/receiver pair, and the retired receiver each track their own start block', () => {
    for (const chain of Object.values(CHAINS)) {
      const yaml = manifest(chain);
      const blocks = [...yaml.matchAll(/startBlock: (\d+)/g)].map((m) => Number(m[1]));
      expect(blocks).toHaveLength(4);

      const [routerBlock, vaultBlock, receiverBlock, retiredReceiverBlock] = blocks;
      expect(routerBlock).toBe(ROUTER_START_BLOCKS[chain.key]);
      expect(vaultBlock).toBe(START_BLOCKS[chain.key]);
      expect(receiverBlock).toBe(START_BLOCKS[chain.key]);
      expect(retiredReceiverBlock).toBe(RETIRED_SETTLEMENT_RECEIVER_START_BLOCKS[chain.key]);
      expect(new Set(blocks).size).toBe(3); // router, live pair, retired — three distinct values
    }
  });
});
