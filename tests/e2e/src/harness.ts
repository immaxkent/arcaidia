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
  toHex,
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
  type FeePolicy,
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
import { NoopTelemetryClient, type TelemetryClient } from '@arcaidia/telemetry';

import { startAnvil, type AnvilChain } from './anvil.js';
import { createVault, depositInto, deployProtocol, mintTo, type ChainDeployment } from './deploy.js';
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
  // WP-29: independent vault operators — their own owner/LP key and their own solver signer.
  ownerB: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // #4
  agentB: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // #5
  ownerC: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e', // #6
  agentC: '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356', // #7
} as const;

const USDC = (whole: number): bigint => BigInt(whole) * 1_000_000n;

export const POLICY = {
  reserveFloorBps: 1_000,
  protocolFeeShareBps: 5_000,
  maxIntentAmount: USDC(25_000),
  maxInFlightValue: USDC(200_000),
  // Same defaults ArcaidiaLiquidityVault.initialize() sets on its own — spelled
  // out here so the deploy is explicit and a test can override them the same
  // way it does every other field.
  maxFillBps: 5_000,
  maxExposureBps: 8_000,
  /**
   * The House Vault's fee tiers (D7). Permissive on purpose: the vault's tier is a *ceiling*
   * on what a solver may charge, and until WP-28 the reference solver still prices from its
   * own `DEFAULT_RISK_POLICY` (10–85 bps), which must stay under it or every fill reverts
   * with `FeeAbovePolicy`. Capped at the protocol maximum.
   */
  feePolicy: {
    baseFeeBps: 100,
    midFeeBps: 110,
    highFeeBps: 120,
    criticalFeeBps: 150,
    midThresholdBps: 5_000,
    highThresholdBps: 7_500,
    criticalThresholdBps: 9_000,
  },
  lpDeposit: USDC(100_000),
  userBalance: USDC(50_000),
  attestationDelaySeconds: 120,
} as const;

/** WP-29: an additional, independently owned vault with its own solver identity. */
export interface VaultSpec {
  readonly chainId: number;
  readonly ownerKey: Hex;
  readonly signerKey: Hex;
  readonly label: string;
  readonly capital: bigint;
  readonly feePolicy: FeePolicy;
  readonly reserveFloorBps?: number;
  readonly maxFillBps?: number;
  readonly maxExposureBps?: number;
}

export interface WorldVault {
  readonly chainId: number;
  readonly address: Address;
  readonly ownerKey: Hex;
  readonly signer: LocalAgentSigner;
  /** This vault's own observation — what *its* solver sees, nobody else's. */
  readonly observation: InMemoryObservationProvider;
  /** Solver dependencies for this vault's operator: own signer, own journal, own vault. */
  solverDeps(): SolverDependencies;
  refresh(intent: Intent): Promise<void>;
  state(): Promise<VaultState>;
  setSwapAdapter(adapter: Address): Promise<void>;
}

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
  erc20BalanceOf(chainId: number, token: Address, who: Address): Promise<bigint>;
  refreshObservation(intent: Intent): Promise<void>;
  /** WP-29: stand up another vault/solver pair through the factory. */
  addVault(spec: VaultSpec): Promise<WorldVault>;
  /** A freely mintable ERC-20 standing in for a destination `tokenOut`. */
  deployMockToken(chainId: number): Promise<Address>;
  /** The Line 1 stand-in: a fixed-rate adapter from USDC into `tokenOut`. */
  deployMockSwapAdapter(chainId: number, tokenOut: Address, rate1e18: bigint): Promise<Address>;
  /** Set the House Vault's adapter (the deployer owns it). */
  setHouseSwapAdapter(chainId: number, adapter: Address): Promise<void>;
  /** Build a byte-exact CCTP V2 message through the mock transmitter and the attestation it accepts. */
  cctpMessage(chainId: number, spec: CctpMessageSpec): Promise<{ message: Hex; attestation: Hex }>;
  /** D8: submit an attested message to the receiver, exactly as the settlement worker does. */
  settleWithProof(chainId: number, message: Hex, attestation: Hex): Promise<{ txHash: Hex; outcome: string }>;
  isSettled(chainId: number, intentId: Hex): Promise<boolean>;
  stop(): void;
}

export interface CctpMessageSpec {
  readonly nonce: Hex;
  readonly amount: bigint;
  readonly feeExecuted?: bigint;
  readonly hookData: Hex;
  /** Defaults to the chain's receiver; override to model a message minted elsewhere. */
  readonly mintRecipient?: Address;
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

  /**
   * Wired into every `solverDeps()` this world hands out.
   *
   * Defaults to `NoopTelemetryClient` — the same "correct without telemetry,
   * not just tolerant of it" default `TELEMETRY_ENABLED=false` gives the real
   * entrypoint (see `packages/agent/src/entrypoint/config.ts`). A test that
   * wants to prove telemetry can vanish without affecting a single fill (WP-17.4)
   * passes a real `HttpTelemetryClient` pointed at an unreachable URL here,
   * rather than a mock — the golden run should not need to know the
   * difference.
   */
  readonly telemetry?: TelemetryClient;
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
    maxFillBps: POLICY.maxFillBps,
    maxExposureBps: POLICY.maxExposureBps,
    feePolicy: POLICY.feePolicy,
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
      telemetry: options.telemetry ?? new NoopTelemetryClient(),
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

    erc20BalanceOf: async (chainId, token, who) =>
      (await chains[chainId]!.client.readContract({
        address: token,
        abi: ARTIFACTS.MockUSDC.abi,
        functionName: 'balanceOf',
        args: [who],
      })) as bigint,

    addVault: async (spec) => {
      const chain = chains[spec.chainId]!;
      const deployment = deployments[spec.chainId]!;
      const ownerAddress = privateKeyToAccount(spec.ownerKey).address;
      const signer = new LocalAgentSigner(spec.signerKey);

      const address = await createVault(chain, deployment, {
        ownerKey: spec.ownerKey,
        salt: keccak256(toHex(`${spec.label}:${spec.chainId}`)),
        label: spec.label,
        reserveFloorBps: spec.reserveFloorBps ?? 0,
        maxFillBps: spec.maxFillBps ?? 10_000,
        maxExposureBps: spec.maxExposureBps ?? 10_000,
        feePolicy: spec.feePolicy,
      });

      // The owner authorises their own solver and funds their own vault — no Arcaidia key.
      const ownerWallet = walletFor(chain, spec.ownerKey) as unknown as WalletClient;
      const authorise = await ownerWallet.writeContract({
        address,
        abi: ARTIFACTS.ArcaidiaLiquidityVault.abi as never,
        functionName: 'setAuthorisedSigner',
        args: [signer.address, true] as never,
      } as never);
      await chain.client.waitForTransactionReceipt({ hash: authorise });
      await mintTo(chain, deployment, ownerAddress, spec.capital);
      await depositInto(chain, deployment, address, spec.ownerKey, spec.capital);

      const ownObservation = new InMemoryObservationProvider();
      const vaultRecord: WorldVault = {
        chainId: spec.chainId,
        address,
        ownerKey: spec.ownerKey,
        signer,
        observation: ownObservation,
        solverDeps: () => ({
          observation: ownObservation,
          sourceReader,
          authority: signer,
          submitter,
          log: decisions,
          clock: now,
          nonces: new SequentialNonceSource(BigInt(Date.now()) * 1_000n),
          journal: new InMemorySubmissionJournal(),
          config: { policy: DEFAULT_RISK_POLICY, authorizationTtlSeconds: 45 },
          telemetry: options.telemetry ?? new NoopTelemetryClient(),
          vaults: new Map([[spec.chainId, address]]),
        }),
        refresh: async (intent) => {
          ownObservation.recordIntent(intent);
          ownObservation.recordVaultState(await readVaultState(chain, deployment, now(), address));
          ownObservation.recordSettlementHealth(
            deriveSettlementHealth(settlementJournal, (await settlementAdapter.health()).transport, now()),
          );
        },
        state: () => readVaultState(chain, deployment, now(), address),
        setSwapAdapter: async (adapter) => {
          const hash = await ownerWallet.writeContract({
            address,
            abi: ARTIFACTS.ArcaidiaLiquidityVault.abi as never,
            functionName: 'setSwapAdapter',
            args: [adapter] as never,
          } as never);
          await chain.client.waitForTransactionReceipt({ hash });
        },
      };
      return vaultRecord;
    },

    deployMockToken: async (chainId) => {
      const deployment = deployments[chainId]!;
      const hash = await deployment.wallet.deployContract({
        abi: ARTIFACTS.MockUSDC.abi as never,
        bytecode: ARTIFACTS.MockUSDC.bytecode,
      } as never);
      const receipt = await chains[chainId]!.client.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) throw new Error('mock token deployment produced no address');
      return receipt.contractAddress;
    },

    deployMockSwapAdapter: async (chainId, tokenOut, rate1e18) => {
      const chain = chains[chainId]!;
      const deployment = deployments[chainId]!;
      const hash = await deployment.wallet.deployContract({
        abi: ARTIFACTS.MockSwapAdapter.abi as never,
        bytecode: ARTIFACTS.MockSwapAdapter.bytecode,
      } as never);
      const receipt = await chain.client.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) throw new Error('adapter deployment produced no address');
      const setRate = await deployment.wallet.writeContract({
        address: receipt.contractAddress,
        abi: ARTIFACTS.MockSwapAdapter.abi as never,
        functionName: 'setRate',
        args: [deployment.usdc, tokenOut, rate1e18] as never,
      } as never);
      await chain.client.waitForTransactionReceipt({ hash: setRate });
      return receipt.contractAddress;
    },

    setHouseSwapAdapter: async (chainId, adapter) => {
      const chain = chains[chainId]!;
      const deployment = deployments[chainId]!;
      const hash = await deployment.wallet.writeContract({
        address: deployment.vault,
        abi: ARTIFACTS.ArcaidiaLiquidityVault.abi as never,
        functionName: 'setSwapAdapter',
        args: [adapter] as never,
      } as never);
      await chain.client.waitForTransactionReceipt({ hash });
    },

    cctpMessage: async (chainId, spec) => {
      const chain = chains[chainId]!;
      const deployment = deployments[chainId]!;
      const message = (await chain.client.readContract({
        address: deployment.messageTransmitter,
        abi: ARTIFACTS.MockMessageTransmitterV2.abi,
        functionName: 'encodeMessage',
        args: [
          {
            sourceDomain: chainId === SEPOLIA ? 26 : 0,
            destinationDomain: chainId === SEPOLIA ? 0 : 26,
            nonce: spec.nonce,
            recipient: deployment.settlementReceiver,
            destinationCaller: deployment.settlementReceiver,
            burnToken: '0x000000000000000000000000000000000000bEEF',
            mintRecipient: spec.mintRecipient ?? deployment.settlementReceiver,
            amount: spec.amount,
            feeExecuted: spec.feeExecuted ?? 0n,
            hookData: spec.hookData,
          },
        ],
      })) as Hex;
      return { message, attestation: keccak256(message) };
    },

    settleWithProof: async (chainId, message, attestation) =>
      receiverClient.settleWithProof(chainId, deployments[chainId]!.settlementReceiver, message, attestation),

    isSettled: (chainId, intentId) =>
      receiverClient.isSettled(chainId, deployments[chainId]!.settlementReceiver, intentId),

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
  vaultAddress: Address = deployment.vault,
): Promise<VaultState> {
  const read = (functionName: string) =>
    chain.client.readContract({
      address: vaultAddress,
      abi: ARTIFACTS.ArcaidiaLiquidityVault.abi as never,
      functionName: functionName as never,
      args: [] as never,
    });

  const [
    totalBalance,
    totalShares,
    reserveFloor,
    maxFillAmount,
    maxOutstandingExposure,
    outstandingExposure,
    accruedProtocolFees,
    paused,
    rawPolicy,
    currentFeeBps,
  ] = (await Promise.all([
    read('liquidBalance'),
    read('totalSupply'),
    read('reserveFloor'),
    read('maxFillAmount'),
    read('maxOutstandingExposure'),
    read('outstandingExposure'),
    read('accruedProtocolFees'),
    read('paused'),
    read('feePolicy'),
    read('currentFeeBps'),
  ])) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, readonly number[], number];
  const [baseFeeBps, midFeeBps, highFeeBps, criticalFeeBps, midThresholdBps, highThresholdBps, criticalThresholdBps] =
    rawPolicy.map(Number) as [number, number, number, number, number, number, number];

  return {
    chainId: chain.chainId,
    vault: vaultAddress,
    asset: deployment.usdc,
    totalBalance,
    totalShares,
    reserveFloor,
    maxFillAmount,
    maxOutstandingExposure,
    outstandingExposure,
    accruedProtocolFees,
    paused,
    feePolicy: { baseFeeBps, midFeeBps, highFeeBps, criticalFeeBps, midThresholdBps, highThresholdBps, criticalThresholdBps },
    currentFeeBps: Number(currentFeeBps),
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
  // Wait for inclusion before returning: `processIntent` reports FILLED from
  // this resolving, and a hash in the mempool is not a fill.
  return {
    writeContract: async (args: Record<string, unknown>) => {
      const hash = await wallet.writeContract(args as never);
      const receipt = await chain.client.waitForTransactionReceipt({ hash });
      if (receipt.status === 'reverted') {
        throw new Error(`Transaction ${hash} reverted.`);
      }
      return hash;
    },
  } as never;
}

export { USDC };
