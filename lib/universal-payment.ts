const COINGECKO_PLATFORMS: Record<number, string> = {
  1: 'ethereum',
  137: 'polygon-pos',
  56: 'binance-smart-chain',
  43114: 'avalanche',
  42161: 'arbitrum-one',
  10: 'optimistic-ethereum',
  8453: 'base',
}

const NATIVE_IDS: Record<number, string> = {
  1: 'ethereum',
  137: 'matic-network',
  56: 'binancecoin',
  43114: 'avalanche-2',
  42161: 'ethereum',
  10: 'ethereum',
  8453: 'ethereum',
}

export async function getTokenPriceUsd(tokenAddress: string, chainId: number): Promise<number | null> {
  try {
    if (tokenAddress === 'native' || tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      const id = NATIVE_IDS[chainId]
      if (!id) return null
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, {
        next: { revalidate: 60 },
      })
      const data = await res.json()
      return data[id]?.usd || null
    }

    const platform = COINGECKO_PLATFORMS[chainId]
    if (!platform) return null

    const key = tokenAddress.toLowerCase()
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${key}&vs_currencies=usd`,
      { next: { revalidate: 60 } },
    )
    const data = await res.json()
    return data[key]?.usd || null
  } catch {
    return null
  }
}

export async function usdToTokenAmount(
  usdAmount: number,
  tokenAddress: string,
  chainId: number,
  decimals: number,
): Promise<bigint | null> {
  const price = await getTokenPriceUsd(tokenAddress, chainId)
  if (!price) return null
  const tokenAmount = usdAmount / price
  return BigInt(Math.ceil(tokenAmount * 10 ** decimals))
}
