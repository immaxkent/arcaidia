/**
 * One sweep of the bots' mock tokens back to USDC, both chains, both wallets.
 *
 *   LOADGEN_USER_KEYS=... tsx packages/loadgen/src/entrypoint/sweep.ts
 */
import { endpoints } from './main.js';
import { sweepTokensToUsdc } from '../sweep.js';

const keys = (process.env.LOADGEN_USER_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean) as `0x${string}`[];
if (keys.length === 0) throw new Error('LOADGEN_USER_KEYS is required.');
const results = await sweepTokensToUsdc(endpoints(), keys, { log: (line) => console.log(`[sweep] ${line}`) });
console.log(`[sweep] ${results.length} swap(s), ~${(results.reduce((a, r) => a + Number(r.usdcOut), 0) / 1e6).toFixed(2)} USDC recovered`);
