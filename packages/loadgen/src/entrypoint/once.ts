/**
 * One intent in each direction, from user bot 0 — the smallest possible live proof of the whole
 * path (create → fast fill → canonical settlement) without starting the load generator.
 *
 *   tsx --env-file=.env.loadgen packages/loadgen/src/entrypoint/once.ts            # 2 USDC each way
 *   ONCE_USDC=5 ONCE_MAX_FEE_BPS=50 tsx --env-file=.env.loadgen packages/loadgen/src/entrypoint/once.ts
 */
import { ViemIntentSubmitter } from '../submit.js';
import { endpoints } from './main.js';

async function main(): Promise<void> {
  const keys = (process.env.LOADGEN_USER_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean) as `0x${string}`[];
  if (keys.length === 0) throw new Error('LOADGEN_USER_KEYS is required.');
  const usdc = Number(process.env.ONCE_USDC ?? '2');
  const maxFeeBps = Number(process.env.ONCE_MAX_FEE_BPS ?? '100');
  const amount = BigInt(Math.round(usdc * 1e6));
  const submitter = new ViemIntentSubmitter(endpoints(), keys);
  const now = Math.floor(Date.now() / 1000);
  for (const [sourceChainId, destinationChainId] of [
    [11155111, 5042002],
    [5042002, 11155111],
  ] as const) {
    const sent = await submitter.submit(
      { at: now, sourceChainId, destinationChainId, amount, maxFeeBps, deadlineSeconds: 3_600, phase: 'background', tag: 'regular' },
      0,
    );
    console.log(`[once] ${usdc} USDC ${sourceChainId}→${destinationChainId} maxFee ${maxFeeBps} bps → intent ${sent.intentId} tx ${sent.txHash}`);
  }
}

main().catch((error: unknown) => {
  console.error('[once] failed:', error);
  process.exitCode = 1;
});
