#!/usr/bin/env -S npx tsx
/**
 * Watches every funded wallet in the ecosystem and says which ones need topping up.
 *
 *   pnpm balances            # redraws every 60s until you stop it
 *   pnpm balances --once     # one report, for a shell or a cron
 *   pnpm balances --json     # the funding plan only; what fund-bots.sh reads
 *
 * The roster, the thresholds and the table live in bot-balances.ts, which is pure and
 * tested. This file is the part that has to touch the world: it derives addresses from
 * the private keys in our env files, reads balances over JSON-RPC, and loops.
 *
 * Addresses are derived with `cast wallet address`, the same way fund-operators.sh and
 * fund-loadgen.sh already do it, once at startup rather than once per poll. Keys are
 * never logged and never leave this process.
 *
 * Reads retry with backoff. Arc's public endpoint rejected 12 calls and timed out on 21
 * more across 70 rounds of the market bot on 2026-09-13, and a watcher that reports a
 * rate limit as an empty wallet is worse than no watcher: it would have us fund wallets
 * that are fine.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  CHAINS,
  ROSTER,
  formatReport,
  fundingPlan,
  keysFrom,
  makeRow,
  parseEnvFile,
  worst,
  type BotSpec,
  type ChainKey,
  type Holding,
  type Read,
  type Row,
} from './bot-balances.js';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_INTERVAL_SECONDS = 60;
const MAX_ATTEMPTS = 4;
const CONCURRENCY = 4;

// --- env -------------------------------------------------------------------

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Endpoints come from the repo's own .env first, so the watcher reads what the bots read. */
function rpcFor(chain: ChainKey, rootEnv: Record<string, string>): string {
  const info = CHAINS[chain];
  return process.env[info.rpcEnv] ?? rootEnv[info.rpcEnv] ?? info.defaultRpc;
}

// --- addresses -------------------------------------------------------------

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Checked rather than trusted: anything else on PATH called `cast` would otherwise have us
 * watching a nonsense address and reporting a healthy wallet as unreadable.
 */
async function deriveAddress(privateKey: string): Promise<string> {
  const { stdout } = await run('cast', ['wallet', 'address', '--private-key', privateKey]);
  const address = stdout.trim();
  if (!ADDRESS.test(address)) throw new Error('cast did not return an address');
  return address;
}

interface Wallet {
  bot: string;
  label: string;
  address: string;
  holdings: Holding[];
}

/** One wallet per key, plus the wallets we know only by address. Missing files are skipped. */
async function resolveWallets(): Promise<{ wallets: Wallet[]; skipped: string[] }> {
  const wallets: Wallet[] = [];
  const skipped: string[] = [];

  for (const spec of ROSTER) {
    if (spec.address) {
      wallets.push({ bot: spec.id, label: spec.label, address: spec.address, holdings: spec.holdings });
      continue;
    }
    const source = spec.key!;
    const text = readIfPresent(join(ROOT, source.file));
    if (text === null) {
      skipped.push(`${spec.label}: ${source.file} not found`);
      continue;
    }
    const keys = keysFrom(spec as BotSpec, text);
    if (keys.length === 0) {
      skipped.push(`${spec.label}: ${source.name} not set in ${source.file}`);
      continue;
    }
    for (const [index, key] of keys.entries()) {
      const label = keys.length > 1 ? `${spec.label} #${index + 1}` : spec.label;
      try {
        wallets.push({ bot: spec.id, label, address: await deriveAddress(key), holdings: spec.holdings });
      } catch {
        // Never echo the failure: the message can carry the key back out.
        skipped.push(`${label}: could not derive an address (is foundry's \`cast\` on PATH?)`);
      }
    }
  }

  return { wallets, skipped };
}

// --- reads -----------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function rpc(url: string, method: string, params: unknown[]): Promise<string> {
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { result?: string; error?: { message?: string } };
      if (body.error) throw new Error(body.error.message ?? 'rpc error');
      if (typeof body.result !== 'string') throw new Error('no result');
      return body.result;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
      if (attempt < MAX_ATTEMPTS) await sleep(250 * 2 ** (attempt - 1));
    }
  }
  throw new Error(lastError);
}

const BALANCE_OF = '0x70a08231';

async function readBalance(url: string, address: string, read: Read): Promise<bigint> {
  if (read.kind === 'native') return BigInt(await rpc(url, 'eth_getBalance', [address, 'latest']));
  const data = `${BALANCE_OF}${address.toLowerCase().replace('0x', '').padStart(64, '0')}`;
  const result = await rpc(url, 'eth_call', [{ to: read.token, data }, 'latest']);
  if (result === '0x') throw new Error('empty eth_call result');
  return BigInt(result);
}

/** Small pool: enough to keep a poll quick, few enough not to trip a public endpoint. */
async function inBatches<T, R>(items: readonly T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(...(await Promise.all(items.slice(index, index + size).map(task))));
  }
  return out;
}

async function collect(wallets: readonly Wallet[], rootEnv: Record<string, string>): Promise<Row[]> {
  const jobs = wallets.flatMap((wallet) => wallet.holdings.map((holding) => ({ wallet, holding })));
  return inBatches(jobs, CONCURRENCY, async ({ wallet, holding }) => {
    try {
      const balance = await readBalance(rpcFor(holding.chain, rootEnv), wallet.address, holding.read);
      return makeRow(wallet.bot, wallet.label, wallet.address, holding, balance);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return makeRow(wallet.bot, wallet.label, wallet.address, holding, null, message.slice(0, 60));
    }
  });
}

// --- entrypoint ------------------------------------------------------------

function intervalSeconds(argv: readonly string[]): number {
  const flag = argv.find((arg) => arg.startsWith('--interval='));
  const parsed = flag ? Number(flag.split('=')[1]) : NaN;
  return Number.isFinite(parsed) && parsed >= 5 ? parsed : DEFAULT_INTERVAL_SECONDS;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const once = argv.includes('--once');
  const json = argv.includes('--json');
  const rootEnv = parseEnvFile(readIfPresent(join(ROOT, '.env')) ?? '');

  const { wallets, skipped } = await resolveWallets();
  if (wallets.length === 0) {
    console.error('No wallets to watch. Are the .env files in place?');
    for (const note of skipped) console.error(`  - ${note}`);
    process.exitCode = 1;
    return;
  }

  const poll = async (): Promise<Row[]> => collect(wallets, rootEnv);

  if (json) {
    console.log(JSON.stringify(fundingPlan(await poll()), null, 2));
    return;
  }

  const colour = process.stdout.isTTY === true;
  const draw = (rows: readonly Row[]): void => {
    const report = formatReport(rows, { colour, at: new Date() });
    const notes = skipped.map((note) => `  (skipped) ${note}`);
    const footer = once ? [] : ['', `refreshing every ${intervalSeconds(argv)}s — ctrl-c to stop`];
    if (!once && colour) process.stdout.write(`${String.fromCharCode(27)}[2J${String.fromCharCode(27)}[H`);
    console.log([report, ...(notes.length > 0 ? ['', ...notes] : []), ...footer].join('\n'));
  };

  const first = await poll();
  draw(first);
  if (once) {
    process.exitCode = worst(first) === 'critical' ? 2 : 0;
    return;
  }

  const every = intervalSeconds(argv) * 1000;
  for (;;) {
    await sleep(every);
    draw(await poll());
  }
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
