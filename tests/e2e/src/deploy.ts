/**
 * Deploys the whole protocol to one local chain.
 *
 * Mirrors `ArcaidiaDeployment.sol`: the deployer takes ownership, wires the
 * contracts together, and the protocol contracts go up through CREATE2 so their
 * addresses are fixed by salt and init code rather than by nonce. Both chains
 * therefore land on the same addresses, which the harness asserts.
 */

import {
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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
  readonly maxFillAmount: bigint;
  readonly maxOutstandingExposure: bigint;
  readonly maxFeeBps: number;
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

  // Deploy and initialize atomically, exactly as production does — there must
  // be no moment at which an uninitialized contract sits at a known address.
  const vault = await send.create2(
    deployerContract,
    SALTS.vault,
    ARTIFACTS.ArcaidiaLiquidityVault.bytecode,
    encodeFunctionData({
      abi: ARTIFACTS.ArcaidiaLiquidityVault.abi,
      functionName: 'initialize',
      args: [account.address, usdc, options.reserveFloorBps],
    }),
  );

  const settlementReceiver = await send.create2(
    deployerContract,
    SALTS.receiver,
    ARTIFACTS.SettlementReceiver.bytecode,
    encodeFunctionData({
      abi: ARTIFACTS.SettlementReceiver.abi,
      functionName: 'initialize',
      args: [account.address, usdc, vault],
    }),
  );

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

  // --- wiring -------------------------------------------------------------

  const vaultCall = (functionName: string, args: readonly unknown[]) =>
    send.call(vault, ARTIFACTS.ArcaidiaLiquidityVault.abi, functionName, args);

  await vaultCall('setSettlementReceiver', [settlementReceiver]);
  await vaultCall('setFillLimits', [
    options.maxFillAmount,
    options.maxOutstandingExposure,
    options.maxFeeBps,
  ]);
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
    wallet,
    owner: account.address,
  };
}

/** Predicts where CREATE2 will place a contract, before deploying it. */
export async function predictAddresses(
  chain: AnvilChain,
  deployerContract: Address,
): Promise<{ vault: Address; receiver: Address; router: Address }> {
  const predict = (salt: Hex, bytecode: Hex) =>
    chain.client.readContract({
      address: deployerContract,
      abi: ARTIFACTS.ArcaidiaDeployer.abi,
      functionName: 'predictAddressFor',
      args: [salt, bytecode],
    }) as Promise<Address>;

  return {
    vault: await predict(SALTS.vault, ARTIFACTS.ArcaidiaLiquidityVault.bytecode),
    receiver: await predict(SALTS.receiver, ARTIFACTS.SettlementReceiver.bytecode),
    router: await predict(SALTS.router, ARTIFACTS.ArcaidiaIntentRouter.bytecode),
  };
}

function sender(client: PublicClient, wallet: WalletClient) {
  const confirm = async (hash: Hex) => {
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted.`);
    return receipt;
  };

  return {
    async deploy(abi: readonly unknown[], bytecode: Hex): Promise<Address> {
      const hash = await wallet.deployContract({ abi: abi as never, bytecode } as never);
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
