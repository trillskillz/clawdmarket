import { createPublicClient, http, isAddress, parseAbi, formatUnits } from 'viem';
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants';

type CacheEntry = { value: number | null; expiresAt: number };
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

const COINGECKO_PLATFORM_BY_CHAIN: Record<number, string> = {
  1: 'ethereum',
  10: 'optimistic-ethereum',
  56: 'binance-smart-chain',
  137: 'polygon-pos',
  8453: 'base',
  42161: 'arbitrum-one',
  43114: 'avalanche',
  42220: 'celo',
  324: 'zksync',
  1101: 'polygon-zkevm',
  [TEMPO_CHAIN_ID]: 'tempo',
};

const USDC_BY_CHAIN: Record<number, `0x${string}`> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  10: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
  137: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  [TEMPO_CHAIN_ID]: PATHUSD_ADDRESS,
};

const UNISWAP_QUOTER_BY_CHAIN: Record<number, `0x${string}`> = {
  1: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  10: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  137: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  8453: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
  42161: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
};

const ERC20_ABI = parseAbi([
  'function decimals() view returns (uint8)',
]);

const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
]);

function cacheKey(tokenAddress: string, chainId: number) {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function getRpcUrl(chainId: number): string | null {
  const specific = process.env[`EVM_RPC_URL_${chainId}` as keyof NodeJS.ProcessEnv] as string | undefined;
  if (specific) return specific;
  const generic = process.env.EVM_RPC_URL;
  if (generic) return generic;
  if (chainId === 1) return 'https://rpc.ankr.com/eth';
  if (chainId === 10) return 'https://rpc.ankr.com/optimism';
  if (chainId === 137) return 'https://rpc.ankr.com/polygon';
  if (chainId === 8453) return 'https://rpc.ankr.com/base';
  if (chainId === 42161) return 'https://rpc.ankr.com/arbitrum';
  return null;
}

async function getPriceFromCoinGecko(tokenAddress: string, chainId: number): Promise<number | null> {
  const platform = COINGECKO_PLATFORM_BY_CHAIN[chainId];
  if (!platform) return null;

  const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${tokenAddress.toLowerCase()}&vs_currencies=usd`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;

  const json = await res.json().catch(() => null) as Record<string, { usd?: number }> | null;
  const price = json?.[tokenAddress.toLowerCase()]?.usd;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
}

async function getPriceFromUniswapQuote(tokenAddress: string, chainId: number): Promise<number | null> {
  const quoter = UNISWAP_QUOTER_BY_CHAIN[chainId];
  const usdc = USDC_BY_CHAIN[chainId];
  const rpcUrl = getRpcUrl(chainId);
  if (!quoter || !usdc || !rpcUrl) return null;
  if (tokenAddress.toLowerCase() === usdc.toLowerCase()) return 1;

  const client = createPublicClient({ transport: http(rpcUrl) });

  const tokenDecimals = Number(await client.readContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'decimals',
  }));

  const usdcDecimals = Number(await client.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: 'decimals',
  }));

  const amountIn = BigInt(10) ** BigInt(tokenDecimals);
  for (const fee of [500, 3000, 10000] as const) {
    try {
      const amountOut = await client.readContract({
        address: quoter,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [tokenAddress as `0x${string}`, usdc, fee, amountIn, BigInt(0)],
      });

      const usdPerToken = Number(formatUnits(amountOut as bigint, usdcDecimals));
      if (Number.isFinite(usdPerToken) && usdPerToken > 0) {
        return usdPerToken;
      }
    } catch {
      // try next fee tier
    }
  }

  return null;
}

export async function getTokenPriceUsd(tokenAddress: string, chainId: number): Promise<number | null> {
  if (!isAddress(tokenAddress) || !Number.isInteger(chainId) || chainId <= 0) return null;

  const key = cacheKey(tokenAddress, chainId);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let price: number | null = null;
  try {
    price = await getPriceFromCoinGecko(tokenAddress, chainId);
    if (price == null) {
      price = await getPriceFromUniswapQuote(tokenAddress, chainId);
    }
  } catch {
    price = null;
  }

  cache.set(key, { value: price, expiresAt: now + CACHE_TTL_MS });
  return price;
}

export async function usdToTokenAmount(
  usdAmount: number,
  tokenAddress: string,
  chainId: number,
  decimals: number,
): Promise<bigint> {
  const price = await getTokenPriceUsd(tokenAddress, chainId);
  if (price == null || !Number.isFinite(price) || price <= 0) {
    throw new Error('Token price could not be determined');
  }

  if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
    throw new Error('Invalid USD amount');
  }

  const base = BigInt(10) ** BigInt(decimals);
  const tokensRequired = usdAmount / price;
  const scaled = Math.ceil(tokensRequired * Number(base));
  return BigInt(scaled);
}
