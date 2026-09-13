/**
 * The roster of funded wallets in the running ecosystem, and the rules that decide
 * when one of them needs topping up.
 *
 * Every process we run broadcasts from a hot key, and each one fails differently when
 * it runs dry: a submitter stops filling, the settlement reporter stops settling, a
 * loadgen user stops creating intents, and the market bot's trend stalls and then
 * reverses (below its USDC floor it turns sell-only). None of those announce
 * themselves - they look like a quiet day. This module is the single place that says
 * which wallets exist, what each needs, and how little is too little.
 *
 * Two facts about this ecosystem are baked in and worth stating once:
 *
 *  - On Arc the native gas token *is* USDC, and the ERC-20 at 0x3600...0000 is the same
 *    balance in 6 decimals rather than a second pot. One native read covers both gas
 *    and trading capital there, so the roster never reads that token.
 *  - Solver *signer* keys (LOCAL_AGENT_PRIVATE_KEY) only sign; the submitter
 *    broadcasts. Signers need no gas, so they are deliberately not on the roster.
 *
 * Everything here is pure: no file I/O, no network, no `process`. balance-watch.ts
 * supplies the addresses and balances, and fund-bots.sh consumes `fundingPlan`, so the
 * thresholds live in exactly one tested place.
 */

export type ChainKey = 'ethereum-sepolia' | 'arc-testnet';

export interface ChainInfo {
  key: ChainKey;
  label: string;
  chainId: number;
  /** Env var the runner prefers for the RPC endpoint. */
  rpcEnv: string;
  defaultRpc: string;
}

export const CHAINS: Record<ChainKey, ChainInfo> = {
  'ethereum-sepolia': {
    key: 'ethereum-sepolia',
    label: 'sepolia',
    chainId: 11155111,
    rpcEnv: 'ETHEREUM_SEPOLIA_RPC_URL',
    defaultRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  'arc-testnet': {
    key: 'arc-testnet',
    label: 'arc',
    chainId: 5042002,
    // drpc.org timed out and failed DNS during the WP-34 runs; this endpoint is the one
    // the market bot uses in anger.
    rpcEnv: 'ARC_TESTNET_RPC_URL',
    defaultRpc: 'https://rpc.testnet.arc.network',
  },
};

export const SEPOLIA_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

/** The wallet every top-up is paid out of. Held in the `deployKey` keystore. */
export const DEPLOYER = '0x538e5E9797fa86eE25e97289439b6A3AbA0165b0';

export type Read = { kind: 'native' } | { kind: 'erc20'; token: string };

export interface Holding {
  chain: ChainKey;
  /** Display symbol, not an identifier - on Arc the native token is USDC. */
  asset: string;
  decimals: number;
  read: Read;
  /** Below this, say so while there is still time to act. */
  low: string;
  /** Below this, the process is about to stop doing its job. */
  critical: string;
  /** What one top-up sends. */
  refill: string;
}

function sepoliaGas(low: string, critical: string, refill: string): Holding {
  return { chain: 'ethereum-sepolia', asset: 'ETH', decimals: 18, read: { kind: 'native' }, low, critical, refill };
}

function sepoliaUsdc(low: string, critical: string, refill: string): Holding {
  return {
    chain: 'ethereum-sepolia',
    asset: 'USDC',
    decimals: 6,
    read: { kind: 'erc20', token: SEPOLIA_USDC },
    low,
    critical,
    refill,
  };
}

/** Arc's native token is USDC; this one balance is both gas and capital. */
function arcUsdc(low: string, critical: string, refill: string): Holding {
  return { chain: 'arc-testnet', asset: 'USDC', decimals: 18, read: { kind: 'native' }, low, critical, refill };
}

export interface KeySource {
  /** Path relative to the repository root. */
  file: string;
  name: string;
  /** True when the value is a comma-separated list of keys, one wallet each. */
  list?: boolean;
}

export interface BotSpec {
  id: string;
  label: string;
  note: string;
  /** Where the private key lives, for wallets we control. */
  key?: KeySource;
  /** A known address, for wallets we watch but hold no key for. */
  address?: string;
  holdings: Holding[];
}

/**
 * Thresholds come from observed burn, not from taste:
 *  - The market bot spent 0.0030 Sepolia ETH and drifted 0.42 Sepolia USDC per hour
 *    over the four hours measured on 2026-09-13, so 0.06 ETH is about twenty hours of
 *    warning and 0.025 about eight. Its own config floors trading USDC at 3.
 *  - Submitters and the reporter only pay gas, a few fills an hour.
 *  - Loadgen users send intents of 1-45 USDC at roughly one every two minutes, and
 *    fund-loadgen.sh tops them up 100 at a time.
 */
export const ROSTER: BotSpec[] = [
  {
    id: 'house-submitter',
    label: 'house submitter',
    note: 'broadcasts the House solver fills',
    key: { file: '.env', name: 'LOCAL_SUBMITTER_PRIVATE_KEY' },
    holdings: [sepoliaGas('0.01', '0.004', '0.03'), arcUsdc('1', '0.3', '3')],
  },
  {
    id: 'reporter',
    label: 'settlement reporter',
    note: 'broadcasts settleWithProof',
    key: { file: '.env', name: 'LOCAL_REPORTER_PRIVATE_KEY' },
    holdings: [sepoliaGas('0.01', '0.004', '0.03'), arcUsdc('1', '0.3', '3')],
  },
  {
    id: 'solver-b-submitter',
    label: 'solver B submitter',
    note: 'independent operator B',
    key: { file: '.env.solver-b', name: 'LOCAL_SUBMITTER_PRIVATE_KEY' },
    holdings: [sepoliaGas('0.01', '0.004', '0.02'), arcUsdc('1', '0.3', '2')],
  },
  {
    id: 'solver-c-submitter',
    label: 'solver C submitter',
    note: 'independent operator C',
    key: { file: '.env.solver-c', name: 'LOCAL_SUBMITTER_PRIVATE_KEY' },
    holdings: [sepoliaGas('0.01', '0.004', '0.02'), arcUsdc('1', '0.3', '2')],
  },
  {
    id: 'loadgen-user',
    label: 'loadgen user',
    note: 'creates intents; needs capital as well as gas',
    key: { file: '.env.loadgen', name: 'LOADGEN_USER_KEYS', list: true },
    holdings: [sepoliaGas('0.02', '0.005', '0.05'), sepoliaUsdc('25', '10', '100'), arcUsdc('25', '10', '100')],
  },
  {
    id: 'market-bot',
    label: 'market bot',
    note: 'drives the Uniswap V2 pools on both chains',
    key: { file: '../uniswap-v2/.env', name: 'MARKET_PRIVATE_KEY' },
    holdings: [sepoliaGas('0.06', '0.025', '0.1'), sepoliaUsdc('12', '6', '20'), arcUsdc('12', '6', '20')],
  },
  {
    id: 'deployer',
    label: 'deployer (funds everyone)',
    note: 'the well every top-up is drawn from',
    address: DEPLOYER,
    holdings: [sepoliaGas('0.1', '0.03', '0'), sepoliaUsdc('30', '10', '0'), arcUsdc('50', '20', '0')],
  },
];

// --- units -----------------------------------------------------------------

/** Decimal string to base units. Rejects anything that is not a plain decimal. */
export function parseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`not a decimal amount: ${value}`);
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) throw new Error(`${value} has more than ${decimals} decimals`);
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}

/** Base units to a short decimal string, trailing zeroes trimmed. */
export function formatUnits(value: bigint, decimals: number, places = 4): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits
    .slice(digits.length - decimals)
    .slice(0, places)
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

// --- env files -------------------------------------------------------------

/** A deliberately small KEY=VALUE reader: these files are ours, not user input. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]!] = match[2]!.trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/** The private keys a spec names, in file order. Empty when the file has no such key. */
export function keysFrom(spec: BotSpec, fileText: string): string[] {
  if (!spec.key) return [];
  const value = parseEnvFile(fileText)[spec.key.name];
  if (!value) return [];
  const parts = spec.key.list ? value.split(',') : [value];
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

// --- classification --------------------------------------------------------

export type Status = 'ok' | 'low' | 'critical' | 'unknown';

export interface Row {
  bot: string;
  /** Distinguishes the wallets of a list-valued spec, e.g. "loadgen user #2". */
  label: string;
  address: string;
  holding: Holding;
  /** null when the balance could not be read; `error` then says why. */
  balance: bigint | null;
  status: Status;
  error?: string;
}

export function classify(balance: bigint | null, holding: Holding): Status {
  if (balance === null) return 'unknown';
  if (balance < parseUnits(holding.critical, holding.decimals)) return 'critical';
  if (balance < parseUnits(holding.low, holding.decimals)) return 'low';
  return 'ok';
}

export function makeRow(
  bot: string,
  label: string,
  address: string,
  holding: Holding,
  balance: bigint | null,
  error?: string,
): Row {
  return { bot, label, address, holding, balance, status: classify(balance, holding), ...(error ? { error } : {}) };
}

const SEVERITY: Record<Status, number> = { ok: 0, unknown: 1, low: 2, critical: 3 };

/** The worst status across rows - what the watcher reports as the state of the world. */
export function worst(rows: readonly Row[]): Status {
  let out: Status = 'ok';
  for (const row of rows) if (SEVERITY[row.status] > SEVERITY[out]) out = row.status;
  return out;
}

// --- funding ---------------------------------------------------------------

export interface FundingLine {
  bot: string;
  label: string;
  address: string;
  chain: ChainKey;
  asset: string;
  decimals: number;
  read: Read;
  /** What to send, as a decimal string. */
  amount: string;
  /** What it holds now, for the operator to sanity-check against. */
  balance: string;
  status: Status;
}

/**
 * What to top up, worst first. Rows we could not read are left out: sending funds on the
 * strength of a failed RPC call is how you pay twice. A refill of "0" means the wallet is
 * not fundable from the deployer (the deployer itself), so it never appears here.
 */
export function fundingPlan(rows: readonly Row[]): FundingLine[] {
  return rows
    .filter((row) => (row.status === 'critical' || row.status === 'low') && row.holding.refill !== '0')
    .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status])
    .map((row) => ({
      bot: row.bot,
      label: row.label,
      address: row.address,
      chain: row.holding.chain,
      asset: row.holding.asset,
      decimals: row.holding.decimals,
      read: row.holding.read,
      amount: row.holding.refill,
      balance: row.balance === null ? 'unknown' : formatUnits(row.balance, row.holding.decimals),
      status: row.status,
    }));
}

// --- report ----------------------------------------------------------------

const MARK: Record<Status, string> = { ok: 'ok', low: 'LOW', critical: 'CRIT', unknown: '??' };

/** Built from a char code so no literal escape byte ever sits in this source file. */
const ESC = String.fromCharCode(27);
const COLOUR: Record<Status, string> = {
  ok: `${ESC}[32m`,
  low: `${ESC}[33m`,
  critical: `${ESC}[31m`,
  unknown: `${ESC}[90m`,
};
const RESET = `${ESC}[0m`;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

export interface ReportOptions {
  colour?: boolean;
  /** Shown in the header so a scrollback tells you when it was true. */
  at?: Date;
}

/** A fixed-width table, worst rows called out by a marker rather than only by colour. */
export function formatReport(rows: readonly Row[], options: ReportOptions = {}): string {
  const colour = options.colour ?? false;
  const cells = rows.map((row) => ({
    row,
    who: row.label,
    chain: CHAINS[row.holding.chain].label,
    balance: row.balance === null ? '-' : formatUnits(row.balance, row.holding.decimals),
    asset: row.holding.asset,
    low: formatUnits(parseUnits(row.holding.low, row.holding.decimals), row.holding.decimals),
  }));

  const w = {
    who: Math.max(6, ...cells.map((c) => c.who.length)),
    chain: Math.max(5, ...cells.map((c) => c.chain.length)),
    balance: Math.max(7, ...cells.map((c) => c.balance.length)),
    asset: Math.max(4, ...cells.map((c) => c.asset.length)),
    low: Math.max(6, ...cells.map((c) => c.low.length)),
  };

  const header = [
    pad('wallet', w.who),
    pad('chain', w.chain),
    padLeft('balance', w.balance),
    pad('', w.asset),
    padLeft('low at', w.low),
    'state',
  ].join('  ');

  const body = cells.map((cell) => {
    const line = [
      pad(cell.who, w.who),
      pad(cell.chain, w.chain),
      padLeft(cell.balance, w.balance),
      pad(cell.asset, w.asset),
      padLeft(cell.low, w.low),
      MARK[cell.row.status] + (cell.row.error ? `  ${cell.row.error}` : ''),
    ].join('  ');
    return colour && cell.row.status !== 'ok' ? `${COLOUR[cell.row.status]}${line}${RESET}` : line;
  });

  const overall = worst(rows);
  const counts = (['critical', 'low', 'unknown'] as const)
    .map((status) => ({ status, n: rows.filter((row) => row.status === status).length }))
    .filter((entry) => entry.n > 0)
    .map((entry) => `${entry.n} ${entry.status}`);

  const stamp = (options.at ?? new Date()).toISOString().replace('T', ' ').slice(0, 19);
  const needsFunding = rows.some((row) => row.status === 'critical' || row.status === 'low');
  const summary =
    overall === 'ok'
      ? `all ${rows.length} balances healthy`
      : `${counts.join(', ')} of ${rows.length}${needsFunding ? '  ->  scripts/fund-bots.sh' : ''}`;

  return [`arcaidia wallets  ${stamp}Z`, '', header, '-'.repeat(header.length), ...body, '', summary].join('\n');
}
