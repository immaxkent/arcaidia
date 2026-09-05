/**
 * Compiled contract artifacts, read from the Foundry build.
 *
 * ABIs come from the shared domain package so nothing here can drift from what
 * the rest of the system uses. Bytecode is read from disk, because deployment
 * is the one thing that needs it and shipping it through the domain package
 * would bloat every consumer that does not.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ABIS, type Hex } from '@arcaidia/domain';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'contracts', 'out');

function bytecodeOf(name: string): Hex {
  const path = join(OUT, `${name}.sol`, `${name}.json`);
  try {
    const artifact = JSON.parse(readFileSync(path, 'utf8')) as { bytecode: { object: string } };
    return artifact.bytecode.object as Hex;
  } catch (error) {
    throw new Error(
      `No build artifact for ${name}. Run \`pnpm contracts:build\` first.\n${String(error)}`,
    );
  }
}

export const ARTIFACTS = {
  MockUSDC: { abi: ABIS.MockUSDC, bytecode: bytecodeOf('MockUSDC') },
  MockSettlementInitiator: {
    abi: ABIS.MockSettlementInitiator,
    bytecode: bytecodeOf('MockSettlementInitiator'),
  },
  ArcaidiaDeployer: { abi: ABIS.ArcaidiaDeployer, bytecode: bytecodeOf('ArcaidiaDeployer') },
  ArcaidiaIntentRouter: {
    abi: ABIS.ArcaidiaIntentRouter,
    bytecode: bytecodeOf('ArcaidiaIntentRouter'),
  },
  ArcaidiaLiquidityVault: {
    abi: ABIS.ArcaidiaLiquidityVault,
    bytecode: bytecodeOf('ArcaidiaLiquidityVault'),
  },
  SettlementReceiver: { abi: ABIS.SettlementReceiver, bytecode: bytecodeOf('SettlementReceiver') },
} as const;

/** Salts must be identical on every chain; they are half of what fixes the addresses. */
export const SALTS = {
  vault: keccakConstant('arcaidia.v1.liquidity-vault'),
  receiver: keccakConstant('arcaidia.v1.settlement-receiver'),
  router: keccakConstant('arcaidia.v1.intent-router'),
} as const;

// Imported lazily to keep this module's surface small.
import { keccak256, toHex } from 'viem';
function keccakConstant(label: string): Hex {
  return keccak256(toHex(label));
}
