/**
 * Executable guardrails for the three rules that are easiest to break by
 * accident and most expensive to unwind later. These scan the domain source, so
 * a violation fails the build rather than surviving to review.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Source with comments stripped: prose may discuss a banned term, code may not. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const files = sourceFiles(SRC);

describe('domain vocabulary guards', () => {
  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('defines no collapsed completion state', () => {
    // Hard requirement: fastStatus and canonicalStatus are separate facts. A
    // `completed` / `done` / `finished` identifier would let a caller answer
    // "is this transfer finished?" with one boolean, which is exactly the
    // misrepresentation the dual-state model exists to prevent.
    const banned = /\b(completed|isComplete|isDone|isFinished|isSettledOrFilled)\b/;
    const offenders = files.filter((file) => banned.test(code(file)));
    expect(offenders).toEqual([]);
  });

  it('names no hardcoded transfer direction', () => {
    // Hard requirement: direction is data. A constant naming a specific pair of
    // chains is the first step towards two parallel implementations.
    const banned = /\b(ETH_TO_ARC|ARC_TO_ETH|ethToArc|arcToEth|processEthToArc|processArcToEth)\b/;
    const offenders = files.filter((file) => banned.test(code(file)));
    expect(offenders).toEqual([]);
  });

  it('carries no runtime mock/real asset switch', () => {
    // Hard requirement: asset selection is deployment configuration. A runtime
    // boolean would fork the protocol's behaviour by asset.
    const banned = /\b(useRealUSDC|useMockUSDC|isMockAsset|MOCK_MODE)\b/;
    const offenders = files.filter((file) => banned.test(code(file)));
    expect(offenders).toEqual([]);
  });

  it('keeps the domain free of sponsor-specific types', () => {
    // The adapter boundary only holds if Circle, Privy and Graph types never
    // reach the shared vocabulary. Chain config may name them as data.
    const banned = /\b(CircleApiResponse|IrisMessage|PrivyUser|GraphQLClient)\b/;
    const offenders = files.filter((file) => banned.test(code(file)));
    expect(offenders).toEqual([]);
  });
});
