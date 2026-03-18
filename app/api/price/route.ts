import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, isAddress, parseAbi } from 'viem';
import { getTokenPriceUsd, usdToTokenAmount } from '@/lib/price-oracle';

const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

function getRpcUrl(chainId: number): string | null {
  const specific = process.env[`EVM_RPC_URL_${chainId}` as keyof NodeJS.ProcessEnv] as string | undefined;
  if (specific) return specific;
  if (process.env.EVM_RPC_URL) return process.env.EVM_RPC_URL;
  if (chainId === 1) return 'https://rpc.ankr.com/eth';
  if (chainId === 10) return 'https://rpc.ankr.com/optimism';
  if (chainId === 137) return 'https://rpc.ankr.com/polygon';
  if (chainId === 8453) return 'https://rpc.ankr.com/base';
  if (chainId === 42161) return 'https://rpc.ankr.com/arbitrum';
  return null;
}

export async function GET(req: NextRequest) {
  const tokenAddress = String(req.nextUrl.searchParams.get('tokenAddress') || '');
  const chainId = Number(req.nextUrl.searchParams.get('chainId') || 0);
  const usdAmount = Number(req.nextUrl.searchParams.get('usdAmount') || 0);
  const providedDecimals = req.nextUrl.searchParams.get('decimals');

  if (!isAddress(tokenAddress) || !Number.isInteger(chainId) || chainId <= 0 || !Number.isFinite(usdAmount) || usdAmount <= 0) {
    return NextResponse.json({ error: 'Invalid query params' }, { status: 400 });
  }

  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    return NextResponse.json({ error: 'Unsupported chainId' }, { status: 400 });
  }

  const client = createPublicClient({ transport: http(rpcUrl) });
  const symbol = String(await client.readContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'symbol',
  }).catch(() => 'TOKEN'));

  const decimals = providedDecimals != null
    ? Number(providedDecimals)
    : Number(await client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'decimals',
      }).catch(() => 18));

  const price = await getTokenPriceUsd(tokenAddress, chainId);
  if (price == null) {
    return NextResponse.json({ error: 'Token price could not be verified. Use a token with a CoinGecko listing.' }, { status: 402 });
  }

  const tokenAmount = await usdToTokenAmount(usdAmount, tokenAddress, chainId, decimals);

  return NextResponse.json({
    tokenAmount: tokenAmount.toString(),
    symbol,
    decimals,
  });
}
