/**
 * One-off WP-09 provisioning script — NOT part of the live solver process.
 *
 * Generates and registers a Circle Entity Secret, then creates a
 * Developer-Controlled Wallet (EOA, ARC-TESTNET) to become the solver's
 * `CircleAgentWalletSigner` authority. Run once; re-running creates a new,
 * separate wallet set rather than mutating anything.
 *
 * The entity secret is the master key for every wallet it protects — it is
 * generated locally, registered with Circle, and written straight to the
 * root `.env`. It is deliberately never `console.log`'d: nothing this script
 * prints should ever let the secret leak into a terminal scrollback or a
 * pasted chat log.
 *
 * Usage (from repo root):
 *   tsx --env-file=.env packages/agent/scripts/setup-circle-agent-wallet.ts
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from '@circle-fin/developer-controlled-wallets';

const ENV_PATH = resolve(import.meta.dirname, '../../../.env');
const RECOVERY_DIR = resolve(import.meta.dirname, '../../../.circle-recovery');
mkdirSync(RECOVERY_DIR, { recursive: true });

function setEnvVar(contents: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (!pattern.test(contents)) {
    throw new Error(`${key}= line not found in .env — expected it to already exist as a placeholder.`);
  }
  return contents.replace(pattern, `${key}=${value}`);
}

async function main(): Promise<void> {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error('CIRCLE_API_KEY is not set.');

  console.log('[1/4] Generating entity secret locally (not printed)...');
  const entitySecret = randomBytes(32).toString('hex');

  console.log('[2/4] Registering entity secret with Circle...');
  const registerResponse = await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: RECOVERY_DIR,
  });
  console.log(`      Registered. Recovery file written under ${RECOVERY_DIR}`);
  console.log(`      recoveryFile field present: ${Boolean(registerResponse.data?.recoveryFile)}`);

  let env = readFileSync(ENV_PATH, 'utf8');
  env = setEnvVar(env, 'CIRCLE_ENTITY_SECRET', entitySecret);
  writeFileSync(ENV_PATH, env);
  console.log('      CIRCLE_ENTITY_SECRET written to .env.');

  console.log('[3/4] Creating wallet set + EOA wallet on ARC-TESTNET...');
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  const walletSetResponse = await client.createWalletSet({
    name: 'Arcaidia Solver Agent Wallet (WP-09)',
  });
  const walletSet = walletSetResponse.data?.walletSet;
  if (!walletSet) throw new Error('createWalletSet returned no wallet set.');

  const walletResponse = await client.createWallets({
    walletSetId: walletSet.id,
    blockchains: ['ARC-TESTNET'],
    count: 1,
    accountType: 'EOA',
  });
  const wallet = walletResponse.data?.wallets?.[0];
  if (!wallet) throw new Error('createWallets returned no wallet.');

  console.log('[4/4] Writing wallet id + address to .env...');
  env = readFileSync(ENV_PATH, 'utf8');
  env = setEnvVar(env, 'CIRCLE_AGENT_WALLET_ID', wallet.id);
  env = setEnvVar(env, 'CIRCLE_AGENT_WALLET_ADDRESS', wallet.address);
  writeFileSync(ENV_PATH, env);

  console.log('');
  console.log('Done.');
  console.log(`  wallet set id : ${walletSet.id}`);
  console.log(`  wallet id     : ${wallet.id}`);
  console.log(`  wallet address: ${wallet.address}`);
  console.log('');
  console.log('Next: grant this address as an authorised solver signer on both chains');
  console.log('(contracts/script/AuthorizeSolverSigner.s.sol, SOLVER_SIGNER_ADDRESS env var).');
}

main().catch((error) => {
  console.error('[circle-setup] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
