/**
 * The whole world, locally.
 *
 * Two chains, the full protocol deployed to both, a solver, a settlement worker
 * and a clock — with no sponsor service running anywhere. Everything a
 * transfer touches in production is present here in the same shape: the
 * observation layer is a cache with the same staleness behaviour as a subgraph,
 * the agent signs the same EIP-712 payload the vault verifies, and the
 * settlement transport goes through the same adapter interface CCTP will.
 *
 * This is what makes the later work packages cheap. Each one replaces exactly
 * one of those with a sponsor service, and any failure afterwards is
 * attributable: if the golden run still passes, the fault is in the
 * integration, not in Arcaidia.
 */

import {
  createWalletClient,
  getContractAddress,
  getCreate2Address,
  http,
  keccak256,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  CHAINS,
  registerChainOverride,
  registerDeployment,
  resetDeployments,
  type Intent,
  type UnixSeconds,
  type VaultState,
} from '@arcaidia/domain';
import {
  DEFAULT_RISK_POLICY,
  InMemoryDecisionLog,
  InMemoryObservationProvider,
  InMemorySubmissionJournal,
  LocalAgentSigner,
  SequentialNonceSource,
  ViemFillSubmitter,
  ViemSourceChainReader,
  type SolverDependencies,
} from '@arcaidia/agent';
import {
  InMemorySettlementJournal,
  MockSettlementAdapter,
  ViemSettlementReceiverClient,
  deriveSettlementHealth,
  type SettlementDependencies,
} from '@arcaidia/settlement';

import { startAnvil, type AnvilChain } from './anvil.js';
import { deployProtocol, type ChainDeployment } from './deploy.js';
import { ARTIFACTS, SALTS } from './artifacts.js';

export const SEPOLIA = CHAINS['ethereum-sepolia'].chainId;
export const ARC = CHAINS['arc-testnet'].chainId;

/**
 * Anvil's standard derived accounts.
 *
 * These must be anvil's own, not arbitrary keys: anvil funds only the accounts
 * it derives, and a wallet with no ether cannot pay for the deployment.
 */
export const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // #0
  agent: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // #1
  user: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // #2
  reporter: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // #3
} as const;

const USDC = (whole: number): bigint => BigInt(whole) * 1_000_000n;

export const POLICY = {
  reserveFloorBps: 1_000,
  protocolFeeShareBps: 5_000,
  maxIntentAmount: USDC(25_000),
  maxInFlightValue: USDC(200_000),
  maxFillAmount: USDC(25_000),
  maxOutstandingExposure: USDC(60_000),
  maxFeeBps: 100,
  lpDeposit: USDC(100_000),
  userBalance: USDC(50_000),
  attestationDelaySeconds: 120,
} as const;

export interface World {
  readonly chains: Record<number, AnvilChain>;
  readonly deployments: Record<number, ChainDeployment>;
  readonly agent: LocalAgentSigner;
  readonly user: Address;
  readonly treasury: Address;
  readonly observation: InMemoryObservationProvider;
  readonly settlementAdapter: MockSettlementAdapter;
  readonly decisions: InMemoryDecisionLog;
  readonly settlementJournal: InMemorySettlementJournal;
  now(): UnixSeconds;
  advance(seconds: number): Promise<void>;
  solverDeps(): SolverDependencies;
  settlementDeps(): SettlementDependencies;
  vaultState(chainId: number): Promise<VaultState>;
  balanceOf(chainId: number, who: Address): Promise<bigint>;
  refreshObservation(intent: Intent): Promise<void>;
  stop(): void;
}

export interface WorldOptions {
  /**
   * Ports for the two chains.
   *
   * Each test file needs its own pair. Vitest gives no ordering guarantee
   * between a file's teardown and the next file's setup, so shared ports mean a
   * second world can connect to the first's chains — and then deploy at higher
   * nonces, which silently breaks CREATE2 address parity.
   */
  readonly ports?: readonly [number, number];
}

export async function startWorld(options: WorldOptions = {}): Promise<World> {
  resetDeployments();

  const [sourcePort, destinationPort] = options.ports ?? [8545, 8546];

  const [sepolia, arc] = await Promise.all([
    startAnvil(SEPOLIA, sourcePort),
    startAnvil(ARC, destinationPort),
  ]);

  const deployerAccount = privateKeyToAccount(KEYS.deployer);
  const agent = new LocalAgentSigner(KEYS.agent);
  const user = privateKeyToAccount(KEYS.user).address;
  const reporter = privateKeyToAccount(KEYS.reporter).address;
  const treasury = '0x000000000000000000000000000000000000dEaD' as Address;

  // Both chains run the same deployment sequence from the same account, so the
  // deployer contract lands at the same address on each — mirroring Arachnid's
  // factory in production. Predicting it here lets each router be configured
  // with the *other* chain's receiver before either exists.
  const deployerContract = getContractAddress({ from: deployerAccount.address, nonce: 2n });
  const predictedReceiver = getCreate2Address({
    from: deployerContract,
    salt: SALTS.receiver,
    bytecodeHash: keccak256(ARTIFACTS.SettlementReceiver.bytecode),
  });

  const deployOptions = {
    deployerKey: KEYS.deployer as Hex,
    destinationReceiver: predictedReceiver,
    settlementReporter: reporter,
    treasury,
    agentSigner: agent.address,
    reserveFloorBps: POLICY.reserveFloorBps,
    protocolFeeShareBps: POLICY.protocolFeeShareBps,
    maxIntentAmount: POLICY.maxIntentAmount,
    maxInFlightValue: POLICY.maxInFlightValue,
    maxFillAmount: POLICY.maxFillAmount,
    maxOutstandingExposure: POLICY.maxOutstandingExposure,
    maxFeeBps: POLICY.maxFeeBps,
  };

  const sepoliaDeployment = await deployProtocol(sepolia, {
    ...deployOptions,
    destinationChainId: ARC,
  });
  const arcDeployment = await deployProtocol(arc, {
    ...deployOptions,
    destinationChainId: SEPOLIA,
  });

  // Point the shared configuration at the local world. Same code path as
  // production; only the values differ.
  registerChainOverride('ethereum-sepolia', {
    rpcUrl: sepolia.rpcUrl,
    settlementAsset: { address: sepoliaDeployment.usdc, symbol: 'USDC', decimals: 6 },
  });
  registerChainOverride('arc-testnet', {
    rpcUrl: arc.rpcUrl,
    settlementAsset: { address: arcDeployment.usdc, symbol: 'USDC', decimals: 6 },
  });
  registerDeployment('ethereum-sepolia', {
    intentRouter: sepoliaDeployment.router,
    liquidityVault: sepoliaDeployment.vault,
    settlementReceiver: sepoliaDeployment.settlementReceiver,
  });
  registerDeployment('arc-testnet', {
    intentRouter: arcDeployment.router,
    liquidityVault: arcDeployment.vault,
    settlementReceiver: arcDeployment.settlementReceiver,
  });

  const chains: Record<number, AnvilChain> = { [SEPOLIA]: sepolia, [ARC]: arc };
  const deployments: Record<number, ChainDeployment> = {
    [SEPOLIA]: sepoliaDeployment,
    [ARC]: arcDeployment,
  };

  // A harness-controlled clock.
  //
  // Attestations take minutes and tests must not, so time is advanced rather
  // than waited out. The chains are advanced with it: an intent's createdAt
  // comes from a block timestamp, so a harness clock that ran ahead of chain
  // time would make every freshly created intent look minutes old and its
  // attestation instantly ready.
  //
  // The chain is the source of truth, and the offset is re-derived from it
  // after every advance. Two clocks that each track real time independently
  // drift apart, and the drift is silent in both directions: a harness clock
  // ahead of the chain makes fresh intents look old, and one behind it makes
  // signed authorizations expire before they land.
  let clockOffset = 0;
  const now = () => Math.floor(Date.now() / 1000) + clockOffset;

  const syncToChain = async () => {
    const block = await sepolia.client.getBlock({ blockTag: 'latest' });
    clockOffset = Number(block.timestamp) - Math.floor(Date.now() / 1000);
  };

  const advance = async (seconds: number) => {
    for (const chain of [sepolia, arc]) {
      await chain.client.request({
        method: 'evm_increaseTime' as never,
        params: [seconds] as never,
      });
      await chain.client.request({ method: 'evm_mine' as never, params: [] as never });
    }
    await syncToChain();
  };

  const observation = new InMemoryObservationProvider();

  // Canonical delivery: real CCTP mints USDC to the destination receiver when a
  // message completes. The mock has no chain of its own, so the harness does
  // that mint — which is what turns an off-chain bookkeeping entry into funds
  // the receiver can actually route.
  const settlementAdapter = new MockSettlementAdapter({
    attestationDelaySeconds: POLICY.attestationDelaySeconds,
    clock: now,
    onComplete: async (reference, amount) => {
      const chain = chains[reference.destinationChainId]!;
      const deployment = deployments[reference.destinationChainId]!;

      const hash = await deployment.wallet.writeContract({
        address: deployment.usdc,
        abi: ARTIFACTS.MockUSDC.abi as never,
        functionName: 'mint',
        args: [deployment.settlementReceiver, amount] as never,
      } as never);
      await chain.client.waitForTransactionReceipt({ hash });
    },
  });
  const decisions = new InMemoryDecisionLog();
  const settlementJournal = new InMemorySettlementJournal();

  const sourceReader = new ViemSourceChainReader(
    new Map([
      [SEPOLIA, sepolia.client],
      [ARC, arc.client],
    ]),
    new Map([
      [SEPOLIA, sepoliaDeployment.router],
      [ARC, arcDeployment.router],
    ]),
  );

  const relayer = (chainId: number) => walletFor(chains[chainId]!, KEYS.reporter);
  const submitter = new ViemFillSubmitter(
    new Map([
      [SEPOLIA, relayer(SEPOLIA)],
      [ARC, relayer(ARC)],
    ]),
  );

  const receiverClient = new ViemSettlementReceiverClient(
    new Map([
      [SEPOLIA, sepolia.client as never],
      [ARC, arc.client as never],
    ]),
    new Map([
      [SEPOLIA, relayer(SEPOLIA) as never],
      [ARC, relayer(ARC) as never],
    ]),
  );

  const world: World = {
    chains,
    deployments,
    agent,
    user,
    treasury,
    observation,
    settlementAdapter,
    decisions,
    settlementJournal,

    now,
    advance,

    solverDeps: () => ({
      observation,
      sourceReader,
      authority: agent,
      submitter,
      log: decisions,
      clock: now,
      nonces: new SequentialNonceSource(BigInt(Date.now())),
      journal: new InMemorySubmissionJournal(),
      config: { policy: DEFAULT_RISK_POLICY, authorizationTtlSeconds: 45 },
    }),

    settlementDeps: () => ({
      adapter: settlementAdapter,
      receivers: new Map([
        [SEPOLIA, sepoliaDeployment.settlementReceiver],
        [ARC, arcDeployment.settlementReceiver],
      ]),
      receiverClient,
      journal: settlementJournal,
      clock: now,
    }),

    vaultState: (chainId) => readVaultState(chains[chainId]!, deployments[chainId]!, now()),

    balanceOf: async (chainId, who) =>
      (await chains[chainId]!.client.readContract({
        address: deployments[chainId]!.usdc,
        abi: ARTIFACTS.MockUSDC.abi,
        functionName: 'balanceOf',
        args: [who],
      })) as bigint,

    refreshObservation: async (intent) => {
      observation.recordIntent(intent);
      observation.recordVaultState(
        await readVaultState(
          chains[intent.destinationChainId]!,
          deployments[intent.destinationChainId]!,
          now(),
        ),
      );
      observation.recordSettlementHealth(
        deriveSettlementHealth(settlementJournal, (await settlementAdapter.health()).transport, now()),
      );
    },

    stop: () => {
      resetDeployments();
      sepolia.stop();
      arc.stop();
    },
  };

  await seed(world);
  await syncToChain();
  return world;
}

/** Mint, fund the vaults and give the user something to send. */
async function seed(world: World): Promise<void> {
  for (const chainId of [SEPOLIA, ARC]) {
    const chain = world.chains[chainId]!;
    const deployment = world.deployments[chainId]!;
    const owner = deployment.owner;

    const mint = async (to: Address, amount: bigint) => {
      const hash = await deployment.wallet.writeContract({
        address: deployment.usdc,
        abi: ARTIFACTS.MockUSDC.abi as never,
        functionName: 'mint',
        args: [to, amount] as never,
      } as never);
      await chain.client.waitForTransactionReceipt({ hash });
    };

    await mint(owner, POLICY.lpDeposit);
    await mint(world.user, POLICY.userBalance);

    // The LP deposits into the vault on both chains, so either can be the
    // destination.
    const approve = await deployment.wallet.writeContract({
      address: deployment.usdc,
      abi: ARTIFACTS.MockUSDC.abi as never,
      functionName: 'approve',
      args: [deployment.vault, POLICY.lpDeposit] as never,
    } as never);
    await chain.client.waitForTransactionReceipt({ hash: approve });

    const deposit = await deployment.wallet.writeContract({
      address: deployment.vault,
      abi: ARTIFACTS.ArcaidiaLiquidityVault.abi as never,
      functionName: 'deposit',
      args: [POLICY.lpDeposit, owner] as never,
    } as never);
    await chain.client.waitForTransactionReceipt({ hash: deposit });
  }
}

async function readVaultState(
  chain: AnvilChain,
  deployment: ChainDeployment,
  observedAt: UnixSeconds,
): Promise<VaultState> {
  const read = (functionName: string) =>
    chain.client.readContract({
      address: deployment.vault,
      abi: ARTIFACTS.ArcaidiaLiquidityVault.abi as never,
      functionName: functionName as never,
      args: [] as never,
    });

  const [totalBalance, totalShares, reserveFloor, outstandingExposure, accruedProtocolFees, paused] =
    (await Promise.all([
      read('liquidBalance'),
      read('totalSupply'),
      read('reserveFloor'),
      read('outstandingExposure'),
      read('accruedProtocolFees'),
      read('paused'),
    ])) as [bigint, bigint, bigint, bigint, bigint, boolean];

  return {
    chainId: chain.chainId,
    vault: deployment.vault,
    asset: deployment.usdc,
    totalBalance,
    totalShares,
    reserveFloor,
    outstandingExposure,
    accruedProtocolFees,
    paused,
    blockNumber: await chain.client.getBlockNumber(),
    observedAt,
  };
}

function walletFor(chain: AnvilChain, key: Hex): never {
  const account = privateKeyToAccount(key);
  const wallet: WalletClient = createWalletClient({
    account,
    chain: chain.chain,
    transport: http(chain.rpcUrl),
  });

  // The adapters need only `writeContract`, so this narrows to exactly that.
  return {
    writeContract: (args: Record<string, unknown>) => wallet.writeContract(args as never),
  } as never;
}

export { USDC };
