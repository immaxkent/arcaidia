/**
 * Deploys the whole protocol to one local chain.
 *
 * Mirrors `ArcaidiaDeployment.sol`: the deployer takes ownership, wires the
 * contracts together, and the protocol contracts go up through CREATE2 so their
 * addresses are fixed by salt and init code rather than by nonce. Both chains
 * therefore land on the same addresses, which the harness asserts.
 */

import {
  concatHex,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { FeePolicy } from '@arcaidia/domain';
import { ARTIFACTS, SALTS } from './artifacts.js';
import type { AnvilChain } from './anvil.js';

export interface ChainDeployment {
  readonly chainId: number;
  readonly usdc: Address;
  readonly settlementInitiator: Address;
  readonly deployerContract: Address;
  readonly router: Address;
  readonly vault: Address;
  readonly settlementReceiver: Address;
  readonly market: Address;
  readonly factory: Address;
  readonly messageTransmitter: Address;
  readonly wallet: WalletClient;
  readonly owner: Address;
}

export interface DeployOptions {
  readonly deployerKey: Hex;
  /** Where the router sends canonical funds. Predicted before deployment. */
  readonly destinationChainId: number;
  readonly destinationReceiver: Address;
  readonly settlementReporter: Address;
  readonly treasury: Address;
  readonly agentSigner: Address;
  readonly reserveFloorBps: number;
  readonly protocolFeeShareBps: number;
  readonly maxIntentAmount: bigint;
  readonly maxInFlightValue: bigint;
  /** Vault's own live cap, as a percentage of `totalAssets()` — see `ArcaidiaLiquidityVault.setFillLimits`. */
  readonly maxFillBps: number;
  readonly maxExposureBps: number;
  /** The House Vault's immutable fee tiers (D7). */
  readonly feePolicy: FeePolicy;
}

export async function deployProtocol(
  chain: AnvilChain,
  options: DeployOptions,
): Promise<ChainDeployment> {
  const account = privateKeyToAccount(options.deployerKey);
  const wallet = createWalletClient({ account, chain: chain.chain, transport: http(chain.rpcUrl) });
  const send = sender(chain.client, wallet);

  const usdc = await send.deploy(ARTIFACTS.MockUSDC.abi, ARTIFACTS.MockUSDC.bytecode);
  const settlementInitiator = await send.deploy(
    ARTIFACTS.MockSettlementInitiator.abi,
    ARTIFACTS.MockSettlementInitiator.bytecode,
  );
  const deployerContract = await send.deploy(
    ARTIFACTS.ArcaidiaDeployer.abi,
    ARTIFACTS.ArcaidiaDeployer.bytecode,
  );
  const messageTransmitter = await send.deploy(
    ARTIFACTS.MockMessageTransmitterV2.abi,
    ARTIFACTS.MockMessageTransmitterV2.bytecode,
    [usdc],
  );

  // Mirrors `ArcaidiaDeployment.deployAll` (v2) step for step. The receiver's init code takes
  // no constructor arguments, so its address is fixed the instant it's deployed — deployed
  // without initializing yet, since `initialize` needs the market, and the market needs the
  // receiver's and the factory's addresses.
  const settlementReceiver = await send.create2(
    deployerContract,
    SALTS.receiver,
    ARTIFACTS.SettlementReceiver.bytecode,
    '0x',
  );

  const predictedFactory = (await chain.client.readContract({
    address: deployerContract,
    abi: ARTIFACTS.ArcaidiaDeployer.abi,
    functionName: 'predictAddressFor',
    args: [SALTS.factory, ARTIFACTS.ArcaidiaVaultFactory.bytecode],
  })) as Address;

  const market = await send.create2(
    deployerContract,
    SALTS.market,
    concatHex([
      ARTIFACTS.ArcaidiaIntentMarket.bytecode,
      encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [settlementReceiver, predictedFactory]),
    ]),
    '0x',
  );

  await send.call(settlementReceiver, ARTIFACTS.SettlementReceiver.abi, 'initialize', [
    account.address,
    usdc,
    market,
    messageTransmitter,
  ]);

  const factory = await send.create2(
    deployerContract,
    SALTS.factory,
    ARTIFACTS.ArcaidiaVaultFactory.bytecode,
    encodeFunctionData({
      abi: ARTIFACTS.ArcaidiaVaultFactory.abi,
      functionName: 'initialize',
      args: [account.address, usdc, market, settlementReceiver],
    }),
  );
  if (factory.toLowerCase() !== predictedFactory.toLowerCase()) {
    throw new Error(`Factory landed at ${factory}, predicted ${predictedFactory}.`);
  }

  const router = await send.create2(
    deployerContract,
    SALTS.router,
    ARTIFACTS.ArcaidiaIntentRouter.bytecode,
    encodeFunctionData({
      abi: ARTIFACTS.ArcaidiaIntentRouter.abi,
      functionName: 'initialize',
      args: [
        account.address,
        usdc,
        settlementInitiator,
        options.maxIntentAmount,
        options.maxInFlightValue,
      ],
    }),
  );

  // The House Vault goes through the same permissionless path as any participant's (D10).
  const vault = (await chain.client.readContract({
    address: factory,
    abi: ARTIFACTS.ArcaidiaVaultFactory.abi,
    functionName: 'predictVault',
    args: [account.address, SALTS.houseVault],
  })) as Address;
  await send.call(factory, ARTIFACTS.ArcaidiaVaultFactory.abi, 'createVault', [
    SALTS.houseVault,
    options.reserveFloorBps,
    options.maxFillBps,
    options.maxExposureBps,
    options.feePolicy,
    'Arcaidia House Vault',
  ]);
  const vaultCode = await chain.client.getCode({ address: vault });
  if (!vaultCode || vaultCode === '0x') throw new Error(`House Vault did not land at ${vault}.`);

  // --- wiring -------------------------------------------------------------

  const vaultCall = (functionName: string, args: readonly unknown[]) =>
    send.call(vault, ARTIFACTS.ArcaidiaLiquidityVault.abi, functionName, args);

  await vaultCall('setAuthorisedSigner', [options.agentSigner, true]);
  await vaultCall('setTreasury', [options.treasury]);
  await vaultCall('setProtocolFeeShareBps', [options.protocolFeeShareBps]);

  await send.call(settlementReceiver, ARTIFACTS.SettlementReceiver.abi, 'setReporter', [
    options.settlementReporter,
    true,
  ]);

  await send.call(router, ARTIFACTS.ArcaidiaIntentRouter.abi, 'setDestination', [
    BigInt(options.destinationChainId),
    options.destinationReceiver,
  ]);

  return {
    chainId: chain.chainId,
    usdc,
    settlementInitiator,
    deployerContract,
    router,
    vault,
    settlementReceiver,
    market,
    factory,
    messageTransmitter,
    wallet,
    owner: account.address,
  };
}

/** Predicts where CREATE2 will place a contract, before deploying it. */
export async function predictAddresses(
  chain: AnvilChain,
  deployerContract: Address,
): Promise<{ receiver: Address; router: Address; factory: Address }> {
  const predict = (salt: Hex, bytecode: Hex) =>
    chain.client.readContract({
      address: deployerContract,
      abi: ARTIFACTS.ArcaidiaDeployer.abi,
      functionName: 'predictAddressFor',
      args: [salt, bytecode],
    }) as Promise<Address>;

  return {
    receiver: await predict(SALTS.receiver, ARTIFACTS.SettlementReceiver.bytecode),
    router: await predict(SALTS.router, ARTIFACTS.ArcaidiaIntentRouter.bytecode),
    factory: await predict(SALTS.factory, ARTIFACTS.ArcaidiaVaultFactory.bytecode),
  };
}

function sender(client: PublicClient, wallet: WalletClient) {
  const confirm = async (hash: Hex) => {
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted.`);
    return receipt;
  };

  return {
    async deploy(abi: readonly unknown[], bytecode: Hex, args: readonly unknown[] = []): Promise<Address> {
      const hash = await wallet.deployContract({ abi: abi as never, bytecode, args } as never);
      const receipt = await confirm(hash);
      if (!receipt.contractAddress) throw new Error('Deployment produced no address.');
      return receipt.contractAddress;
    },

    async call(
      address: Address,
      abi: readonly unknown[],
      functionName: string,
      args: readonly unknown[],
    ): Promise<void> {
      const hash = await wallet.writeContract({
        address,
        abi: abi as never,
        functionName,
        args: args as never,
      } as never);
      await confirm(hash);
    },

    async create2(
      deployerContract: Address,
      salt: Hex,
      bytecode: Hex,
      initCall: Hex,
    ): Promise<Address> {
      const predicted = (await client.readContract({
        address: deployerContract,
        abi: ARTIFACTS.ArcaidiaDeployer.abi,
        functionName: 'predictAddressFor',
        args: [salt, bytecode],
      })) as Address;

      const hash = await wallet.writeContract({
        address: deployerContract,
        abi: ARTIFACTS.ArcaidiaDeployer.abi as never,
        functionName: 'deploy',
        args: [salt, bytecode, initCall] as never,
      } as never);
      await confirm(hash);

      const code = await client.getCode({ address: predicted });
      if (!code || code === '0x') {
        throw new Error(`CREATE2 deployment did not land at the predicted address ${predicted}.`);
      }
      return predicted;
    },
  };
}

// ---------------------------------------------------------------------------
// WP-29: more vaults, the permissionless way — through the factory, by any key
// ---------------------------------------------------------------------------

export interface CreateVaultParams {
  /** Pays gas, becomes the vault's owner. Anyone; no Arcaidia key involved. */
  readonly ownerKey: Hex;
  readonly salt: Hex;
  readonly label: string;
  readonly reserveFloorBps: number;
  readonly maxFillBps: number;
  readonly maxExposureBps: number;
  readonly feePolicy: FeePolicy;
}

/** Create a standard vault through the factory and return its (predicted == actual) address. */
export async function createVault(
  chain: AnvilChain,
  deployment: ChainDeployment,
  params: CreateVaultParams,
): Promise<Address> {
  const account = privateKeyToAccount(params.ownerKey);
  const wallet = createWalletClient({ account, chain: chain.chain, transport: http(chain.rpcUrl) });

  const predicted = (await chain.client.readContract({
    address: deployment.factory,
    abi: ARTIFACTS.ArcaidiaVaultFactory.abi,
    functionName: 'predictVault',
    args: [account.address, params.salt],
  })) as Address;

  const hash = await wallet.writeContract({
    address: deployment.factory,
    abi: ARTIFACTS.ArcaidiaVaultFactory.abi as never,
    functionName: 'createVault',
    args: [
      params.salt,
      params.reserveFloorBps,
      params.maxFillBps,
      params.maxExposureBps,
      params.feePolicy,
      params.label,
    ] as never,
  } as never);
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('createVault reverted.');

  const code = await chain.client.getCode({ address: predicted });
  if (!code || code === '0x') throw new Error(`Vault did not land at ${predicted}.`);
  return predicted;
}

/** MockUSDC is freely mintable — the harness's stand-in for a faucet. */
export async function mintTo(chain: AnvilChain, deployment: ChainDeployment, to: Address, amount: bigint): Promise<void> {
  const hash = await deployment.wallet.writeContract({
    address: deployment.usdc,
    abi: ARTIFACTS.MockUSDC.abi as never,
    functionName: 'mint',
    args: [to, amount] as never,
  } as never);
  await chain.client.waitForTransactionReceipt({ hash });
}

/** An LP deposits into a vault with their own key. */
export async function depositInto(
  chain: AnvilChain,
  deployment: ChainDeployment,
  vault: Address,
  lpKey: Hex,
  amount: bigint,
): Promise<void> {
  const account = privateKeyToAccount(lpKey);
  const wallet = createWalletClient({ account, chain: chain.chain, transport: http(chain.rpcUrl) });
  const send = sender(chain.client, wallet);
  await send.call(deployment.usdc, ARTIFACTS.MockUSDC.abi, 'approve', [vault, amount]);
  await send.call(vault, ARTIFACTS.ArcaidiaLiquidityVault.abi, 'deposit', [amount, account.address]);
}
