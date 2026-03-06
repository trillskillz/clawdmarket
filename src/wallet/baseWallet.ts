import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

export type BaseNetwork = 'base' | 'base-sepolia';

export type BaseWalletConfig = {
  network?: BaseNetwork;
  rpcUrl?: string;
  bnkrTokenAddress?: Address;
  privateKey?: `0x${string}`;
  pollIntervalMs?: number;
};

export type WalletIdentity = {
  address: Address;
  privateKeyRef: 'env';
};

export type BNKRBalance = {
  wallet: Address;
  token: Address;
  raw: bigint;
  formatted: string;
  decimals: number;
};

export type SendBNKRParams = {
  to: Address;
  amount: string;
  fromPrivateKey?: `0x${string}`;
};

export type SendBNKRResult = {
  txHash: Hash;
  estimatedGas: bigint;
};

export type IncomingTransfer = {
  txHash: Hash;
  from: Address;
  to: Address;
  value: bigint;
  blockNumber: bigint;
};

const transferEvent = erc20Abi.find((x) => x.type === 'event' && x.name === 'Transfer');

function getChain(network: BaseNetwork) {
  return network === 'base' ? base : baseSepolia;
}

function getEnvTokenAddress(): Address {
  const configured = process.env.BASE_BNKR_TOKEN_ADDRESS || process.env.NEXT_PUBLIC_BANKR_TOKEN_ADDRESS;
  if (!configured || !isAddress(configured)) {
    throw new Error('Missing valid BASE_BNKR_TOKEN_ADDRESS (or NEXT_PUBLIC_BANKR_TOKEN_ADDRESS).');
  }
  return configured;
}

function getEnvPrivateKey(): `0x${string}` {
  const pk = process.env.AGENT_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk || !pk.startsWith('0x') || pk.length !== 66) {
    throw new Error('Missing valid AGENT_WALLET_PRIVATE_KEY env var.');
  }
  return pk;
}

export class BaseWalletService {
  public readonly network: BaseNetwork;
  public readonly chain = getChain(this.network);
  public readonly bnkrTokenAddress: Address;
  private readonly publicClient: PublicClient;
  private readonly defaultPrivateKey?: `0x${string}`;
  private readonly pollIntervalMs: number;

  constructor(config: BaseWalletConfig = {}) {
    this.network = config.network ?? 'base';
    this.bnkrTokenAddress = config.bnkrTokenAddress ?? getEnvTokenAddress();
    this.defaultPrivateKey = config.privateKey;
    this.pollIntervalMs = config.pollIntervalMs ?? 7_000;

    const transportUrl = config.rpcUrl || (this.network === 'base' ? process.env.BASE_MAINNET_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL);
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: transportUrl ? http(transportUrl) : http(),
    });
  }

  createAgentWallet(): { address: Address; privateKey: `0x${string}` } {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    return { address: account.address, privateKey };
  }

  importAgentWallet(privateKey?: `0x${string}`): WalletIdentity {
    const key = privateKey ?? this.defaultPrivateKey ?? getEnvPrivateKey();
    const account = privateKeyToAccount(key);
    return { address: account.address, privateKeyRef: 'env' };
  }

  async getBNKRBalance(address: Address): Promise<BNKRBalance> {
    const [raw, decimals] = await Promise.all([
      this.publicClient.readContract({
        address: this.bnkrTokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.bnkrTokenAddress,
        abi: erc20Abi,
        functionName: 'decimals',
      }) as Promise<number>,
    ]);

    return {
      wallet: address,
      token: this.bnkrTokenAddress,
      raw,
      decimals,
      formatted: formatUnits(raw, decimals),
    };
  }

  async estimateSendBNKRGas(from: Address, to: Address, amount: string): Promise<bigint> {
    const decimals = (await this.publicClient.readContract({
      address: this.bnkrTokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    })) as number;

    const parsedAmount = parseUnits(amount, decimals);

    return await this.publicClient.estimateContractGas({
      account: from,
      address: this.bnkrTokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, parsedAmount],
    });
  }

  async sendBNKR(params: SendBNKRParams): Promise<SendBNKRResult> {
    const key = params.fromPrivateKey ?? this.defaultPrivateKey ?? getEnvPrivateKey();
    const account = privateKeyToAccount(key);

    const decimals = (await this.publicClient.readContract({
      address: this.bnkrTokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    })) as number;

    const amount = parseUnits(params.amount, decimals);
    const estimatedGas = await this.publicClient.estimateContractGas({
      account: account.address,
      address: this.bnkrTokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [params.to, amount],
    });

    const walletClient: WalletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: this.publicClient.transport,
    });

    const txHash = await walletClient.writeContract({
      address: this.bnkrTokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [params.to, amount],
      gas: estimatedGas,
    });

    return { txHash, estimatedGas };
  }

  async getCurrentBlockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }

  async waitForIncomingBNKR(
    wallet: Address,
    opts?: { timeoutMs?: number; fromBlock?: bigint },
  ): Promise<IncomingTransfer | null> {
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const deadline = Date.now() + timeoutMs;
    let cursor = opts?.fromBlock ?? (await this.publicClient.getBlockNumber());

    while (Date.now() < deadline) {
      const latest = await this.publicClient.getBlockNumber();
      if (latest >= cursor) {
        const logs = await this.publicClient.getLogs({
          address: this.bnkrTokenAddress,
          fromBlock: cursor,
          toBlock: latest,
        });

        for (const log of logs) {
          if (!transferEvent) continue;
          const decoded = decodeEventLog({
            abi: [transferEvent],
            data: log.data,
            topics: log.topics,
          });

          if (decoded.eventName !== 'Transfer') continue;
          const args = decoded.args as { from: Address; to: Address; value: bigint };
          if (args.to.toLowerCase() !== wallet.toLowerCase()) continue;

          return {
            txHash: log.transactionHash as Hash,
            from: args.from,
            to: args.to,
            value: args.value,
            blockNumber: log.blockNumber ?? latest,
          };
        }

        cursor = latest + 1n;
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    return null;
  }
}
