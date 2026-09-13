import { describe, expect, it } from 'vitest';
import {
  CHAINS,
  DEPLOYER,
  ROSTER,
  classify,
  formatReport,
  formatUnits,
  fundingPlan,
  keysFrom,
  makeRow,
  parseEnvFile,
  parseUnits,
  worst,
  alertSignature,
  type BotSpec,
  type Holding,
  type Row,
} from './bot-balances.js';

const GAS: Holding = {
  chain: 'ethereum-sepolia',
  asset: 'ETH',
  decimals: 18,
  read: { kind: 'native' },
  low: '0.01',
  critical: '0.004',
  refill: '0.03',
};

const USDC: Holding = {
  chain: 'ethereum-sepolia',
  asset: 'USDC',
  decimals: 6,
  read: { kind: 'erc20', token: '0xUSDC' },
  low: '25',
  critical: '10',
  refill: '100',
};

const row = (holding: Holding, balance: bigint | null, label = 'a bot', error?: string): Row =>
  makeRow(label, label, '0xabc', holding, balance, error);

describe('parseUnits', () => {
  it('scales whole and fractional amounts to base units', () => {
    expect(parseUnits('1', 18)).toBe(10n ** 18n);
    expect(parseUnits('0.004', 18)).toBe(4_000_000_000_000_000n);
    expect(parseUnits('25', 6)).toBe(25_000_000n);
    expect(parseUnits('0', 6)).toBe(0n);
  });

  /** A threshold typed with one decimal too many would silently truncate and under-alert. */
  it('refuses more precision than the asset has', () => {
    expect(() => parseUnits('0.0000001', 6)).toThrow(/more than 6 decimals/);
  });

  it('refuses anything that is not a plain decimal', () => {
    for (const bad of ['', 'abc', '1e18', '-1', '1.2.3']) {
      expect(() => parseUnits(bad, 18)).toThrow(/not a decimal amount|more than/);
    }
  });
});

describe('formatUnits', () => {
  it('round-trips the amounts we display', () => {
    expect(formatUnits(10n ** 18n, 18)).toBe('1');
    expect(formatUnits(parseUnits('0.1755', 18), 18)).toBe('0.1755');
    expect(formatUnits(31_978_000n, 6)).toBe('31.978');
  });

  it('trims to the requested places without rounding up a healthy balance', () => {
    expect(formatUnits(parseUnits('0.00399999', 18), 18, 4)).toBe('0.0039');
  });

  it('keeps a zero balance readable', () => {
    expect(formatUnits(0n, 18)).toBe('0');
  });
});

describe('classify', () => {
  it('calls a balance below critical critical, and below low low', () => {
    expect(classify(parseUnits('0.003', 18), GAS)).toBe('critical');
    expect(classify(parseUnits('0.008', 18), GAS)).toBe('low');
    expect(classify(parseUnits('0.5', 18), GAS)).toBe('ok');
  });

  /** Thresholds are floors, not fences: sitting exactly on one is still fine. */
  it('treats a balance exactly on a threshold as the healthier side', () => {
    expect(classify(parseUnits('0.004', 18), GAS)).toBe('low');
    expect(classify(parseUnits('0.01', 18), GAS)).toBe('ok');
  });

  it('reports an unread balance as unknown rather than as empty', () => {
    expect(classify(null, GAS)).toBe('unknown');
  });
});

describe('worst', () => {
  it('surfaces the most severe row', () => {
    expect(worst([row(GAS, parseUnits('1', 18)), row(GAS, parseUnits('0.008', 18))])).toBe('low');
    expect(worst([row(GAS, parseUnits('0.008', 18)), row(GAS, 0n)])).toBe('critical');
  });

  /** An unreadable balance is worse than healthy but not a reason to send funds. */
  it('ranks unknown above ok and below low', () => {
    expect(worst([row(GAS, parseUnits('1', 18)), row(GAS, null)])).toBe('unknown');
    expect(worst([row(GAS, null), row(GAS, parseUnits('0.008', 18))])).toBe('low');
  });

  it('is ok when there is nothing to report', () => {
    expect(worst([])).toBe('ok');
  });
});

describe('fundingPlan', () => {
  it('lists what to send, worst first', () => {
    const plan = fundingPlan([
      row(GAS, parseUnits('0.008', 18), 'low one'),
      row(USDC, parseUnits('1', 6), 'empty one'),
      row(GAS, parseUnits('1', 18), 'healthy one'),
    ]);

    expect(plan.map((line) => line.label)).toEqual(['empty one', 'low one']);
    expect(plan[0]).toMatchObject({ amount: '100', asset: 'USDC', balance: '1', status: 'critical' });
    expect(plan[1]).toMatchObject({ amount: '0.03', asset: 'ETH', status: 'low' });
  });

  /** Funding on the strength of a failed read is how you send twice. */
  it('never funds a balance it could not read', () => {
    expect(fundingPlan([row(GAS, null, 'unread', 'timeout')])).toEqual([]);
  });

  it('leaves out wallets that are not fundable from the deployer', () => {
    const notFundable: Holding = { ...GAS, refill: '0' };
    expect(fundingPlan([row(notFundable, 0n, 'the deployer')])).toEqual([]);
  });

  it('carries the read method through so the funder knows native from ERC-20', () => {
    const plan = fundingPlan([row(USDC, 0n), row(GAS, 0n)]);
    expect(plan.map((line) => line.read)).toEqual([
      { kind: 'erc20', token: '0xUSDC' },
      { kind: 'native' },
    ]);
  });
});

describe('alertSignature', () => {
  it('is empty while everything is healthy', () => {
    expect(alertSignature([row(GAS, parseUnits('1', 18))])).toBe('');
  });

  /** A balance that moved but stayed healthy must not make the watcher speak twice. */
  it('does not change when only the balances move', () => {
    const before = alertSignature([row(GAS, parseUnits('1', 18)), row(GAS, parseUnits('0.008', 18), 'thin')]);
    const after = alertSignature([row(GAS, parseUnits('0.9', 18)), row(GAS, parseUnits('0.007', 18), 'thin')]);
    expect(after).toBe(before);
  });

  it('changes when a wallet crosses a threshold', () => {
    const low = alertSignature([row(GAS, parseUnits('0.008', 18), 'thin')]);
    const critical = alertSignature([row(GAS, parseUnits('0.001', 18), 'thin')]);
    expect(critical).not.toBe(low);
  });

  it('changes when another wallet joins the unhealthy set', () => {
    const one = alertSignature([row(GAS, 0n, 'a')]);
    const two = alertSignature([row(GAS, 0n, 'a'), row(GAS, 0n, 'b')]);
    expect(two).not.toBe(one);
  });

  /** Row order is an accident of how the polls were batched, not a change worth printing. */
  it('ignores the order rows arrive in', () => {
    const a = row(GAS, 0n, 'a');
    const b = row(USDC, 0n, 'b');
    expect(alertSignature([a, b])).toBe(alertSignature([b, a]));
  });

  it('notes a wallet that became unreadable', () => {
    expect(alertSignature([row(GAS, null, 'offline', 'timeout')])).toContain('unknown');
  });
});

describe('formatReport', () => {
  const at = new Date('2026-09-13T12:00:00Z');

  it('says plainly when everything is healthy', () => {
    const report = formatReport([row(GAS, parseUnits('1', 18))], { at });
    expect(report).toContain('2026-09-13 12:00:00Z');
    expect(report).toContain('all 1 balances healthy');
    expect(report).not.toContain('fund-bots');
  });

  it('counts the unhealthy rows and points at the funding script', () => {
    const report = formatReport([row(GAS, 0n, 'flat'), row(GAS, parseUnits('0.008', 18), 'thin'), row(GAS, parseUnits('9', 18))], {
      at,
    });
    expect(report).toContain('1 critical, 1 low of 3');
    expect(report).toContain('scripts/fund-bots.sh');
    expect(report).toContain('CRIT');
    expect(report).toContain('LOW');
  });

  /** An unreadable balance must not look like a zero balance. */
  it('shows an unread balance as a dash with its reason, not as zero', () => {
    const report = formatReport([row(GAS, null, 'offline', 'fetch failed')], { at });
    expect(report).toContain('fetch failed');
    expect(report).toMatch(/offline.*-\s+ETH/);
    expect(report).not.toContain('scripts/fund-bots.sh');
  });

  it('adds colour only when asked, and only to rows that need attention', () => {
    const rows = [row(GAS, parseUnits('1', 18), 'fine'), row(GAS, 0n, 'flat')];
    const escape = String.fromCharCode(27);
    expect(formatReport(rows, { at, colour: false })).not.toContain(escape);

    const coloured = formatReport(rows, { at, colour: true }).split('\n');
    expect(coloured.find((line) => line.startsWith('fine'))).toBeDefined();
    expect(coloured.some((line) => line.includes(escape) && line.includes('flat'))).toBe(true);
  });

  it('lines the columns up so the table stays readable as names vary in length', () => {
    const report = formatReport([row(GAS, parseUnits('1', 18), 'a'), row(USDC, parseUnits('30', 6), 'a much longer name')], {
      at,
    });
    const [first, second] = report.split('\n').filter((line) => /\bok\b/.test(line));
    expect(first!.indexOf('ok')).toBe(second!.indexOf('ok'));
  });
});

describe('parseEnvFile', () => {
  it('reads the shapes our env files actually use', () => {
    const parsed = parseEnvFile(['# a comment', 'A=1', 'B = two ', 'C="quoted"', 'nonsense', ''].join('\n'));
    expect(parsed).toEqual({ A: '1', B: 'two', C: 'quoted' });
  });
});

describe('keysFrom', () => {
  const single: BotSpec = { id: 's', label: 's', note: '', key: { file: '.env', name: 'K' }, holdings: [] };
  const many: BotSpec = { id: 'm', label: 'm', note: '', key: { file: '.env', name: 'K', list: true }, holdings: [] };

  it('reads one key, and a comma-separated list as several', () => {
    expect(keysFrom(single, 'K=0xaaa\n')).toEqual(['0xaaa']);
    expect(keysFrom(many, 'K=0xaaa, 0xbbb\n')).toEqual(['0xaaa', '0xbbb']);
  });

  it('returns nothing when the file does not carry that key', () => {
    expect(keysFrom(single, 'OTHER=1\n')).toEqual([]);
    expect(keysFrom(many, 'K=\n')).toEqual([]);
  });

  it('reads nothing for a wallet we only know by address', () => {
    expect(keysFrom({ id: 'd', label: 'd', note: '', address: DEPLOYER, holdings: [] }, 'K=0xaaa')).toEqual([]);
  });
});

describe('ROSTER', () => {
  it('gives every wallet either a key to derive from or a known address', () => {
    for (const spec of ROSTER) {
      expect(Boolean(spec.key) !== Boolean(spec.address), `${spec.id} needs exactly one source`).toBe(true);
      expect(spec.holdings.length).toBeGreaterThan(0);
    }
  });

  it('states every threshold in units the asset can actually express', () => {
    for (const spec of ROSTER) {
      for (const holding of spec.holdings) {
        expect(() => parseUnits(holding.low, holding.decimals)).not.toThrow();
        expect(() => parseUnits(holding.critical, holding.decimals)).not.toThrow();
        expect(() => parseUnits(holding.refill, holding.decimals)).not.toThrow();
        expect(parseUnits(holding.critical, holding.decimals)).toBeLessThan(parseUnits(holding.low, holding.decimals));
      }
    }
  });

  /** A refill that does not clear the low mark leaves the wallet alerting straight after funding. */
  it('refills fundable wallets past their low mark', () => {
    for (const spec of ROSTER) {
      for (const holding of spec.holdings) {
        if (holding.refill === '0') continue;
        expect(
          parseUnits(holding.refill, holding.decimals),
          `${spec.id} ${holding.chain} ${holding.asset}`,
        ).toBeGreaterThanOrEqual(parseUnits(holding.low, holding.decimals));
      }
    }
  });

  it('watches both chains and names a real RPC for each', () => {
    const chains = new Set(ROSTER.flatMap((spec) => spec.holdings.map((holding) => holding.chain)));
    expect([...chains].sort()).toEqual(['arc-testnet', 'ethereum-sepolia']);
    for (const chain of Object.values(CHAINS)) expect(chain.defaultRpc).toMatch(/^https:\/\//);
  });

  /** Arc's native token is USDC; a second ERC-20 read there would double-count the same pot. */
  it('reads Arc natively and never through the mirrored ERC-20', () => {
    const arc = ROSTER.flatMap((spec) => spec.holdings).filter((holding) => holding.chain === 'arc-testnet');
    expect(arc.length).toBeGreaterThan(0);
    for (const holding of arc) expect(holding.read).toEqual({ kind: 'native' });
  });

  it('includes the deployer, and never asks anyone to fund it', () => {
    const deployer = ROSTER.find((spec) => spec.id === 'deployer');
    expect(deployer?.address).toBe(DEPLOYER);
    for (const holding of deployer!.holdings) expect(holding.refill).toBe('0');
  });

  /** Signers only sign. Putting one on the roster would raise an alert nothing can fix. */
  it('leaves solver signer keys off the roster', () => {
    const named = ROSTER.flatMap((spec) => (spec.key ? [spec.key.name] : []));
    expect(named).not.toContain('LOCAL_AGENT_PRIVATE_KEY');
  });
});
