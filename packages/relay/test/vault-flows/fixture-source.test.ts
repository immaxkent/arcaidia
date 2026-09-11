import { describe, expect, it } from 'vitest';
import {
  FixtureParseError,
  FixtureVaultFlowSource,
  extractJsonPayload,
  parseVaultFlowsCapture,
} from '../../src/vault-flows/fixture-source.js';

const FIXTURE_PATH = '../../../../substreams/erc4626-vault-flows/verification/sepolia-block-11675763.json';

const ARCAIDIA_VAULT = '0xc74e693938dfbf7c11b787ba27cdde4c0215aaf1';
const STRANGER_VAULTS = [
  '0x753937137eb92871a6f3517514d4f1ee860e3fdf',
  '0x93083f60f1877a6ba974d5ed88bb74943deb8390',
  '0x93310a56147b1ea7486ab84f8d850fd0a216429b',
];

describe('extractJsonPayload', () => {
  it('isolates the JSON object from the CLI trace/report text on either side', () => {
    const raw = 'TraceID: abc\nSome trace text\n{"a": 1}\n\n📊 Usage Report\nDone';
    expect(extractJsonPayload(raw)).toBe('{"a": 1}');
  });

  it('throws a FixtureParseError when there is no JSON object at all', () => {
    expect(() => extractJsonPayload('just some CLI text, no braces')).toThrow(FixtureParseError);
  });
});

/// Known-answer test against the real, live-captured fixture — not a
/// synthetic one. Cross-checked against verification/README.md's own
/// numbers (independently verified via `cast call totalSupply()`), and
/// against WP-21's own doc comment: three of the four decoded vaults are
/// strangers this project has never configured, which is exactly the point.
describe('parseVaultFlowsCapture — real committed fixture', () => {
  it('decodes all four real deposits from the live-captured Sepolia block', async () => {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(new URL(FIXTURE_PATH, import.meta.url), 'utf8');
    const events = parseVaultFlowsCapture(raw);

    expect(events).toHaveLength(4);
    expect(events.every((e) => e.kind === 'DEPOSIT')).toBe(true);
    expect(new Set(events.map((e) => e.vault))).toEqual(
      new Set([ARCAIDIA_VAULT, ...STRANGER_VAULTS]),
    );
  });

  it("decodes Arcaidia's own real deposit to the exact real values", async () => {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(new URL(FIXTURE_PATH, import.meta.url), 'utf8');
    const events = parseVaultFlowsCapture(raw);

    const arcaidia = events.find((e) => e.vault === ARCAIDIA_VAULT);
    expect(arcaidia).toMatchObject({
      kind: 'DEPOSIT',
      assets: 100_000_000n, // 100 USDC at 6 decimals — matches README's cast call cross-check
      shares: 100_000_000_000_000n,
      blockNumber: 11_675_763,
      sender: '0x538e5e9797fa86ee25e97289439b6a3aba0165b0',
    });
  });
});

describe('FixtureVaultFlowSource', () => {
  it('reads and parses the real fixture file end to end', async () => {
    const source = new FixtureVaultFlowSource(new URL(FIXTURE_PATH, import.meta.url).pathname);
    const events = await source.readVaultFlows();
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.vault === ARCAIDIA_VAULT)).toBe(true);
  });
});
