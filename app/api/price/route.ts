import { NextRequest, NextResponse } from 'next/server'
import { getTokenDecimals, getTokenPriceUsd, usdToTokenAmount } from '@/lib/price-oracle'
import BigNumber from 'bignumber.js'
import { isAddress } from 'viem'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
  const limit = await rateLimit(`token-price:${ip}`, { interval: 60_000, maxRequests: 30, failClosed: true })
  if (!limit.success) {
    return NextResponse.json({ error: 'rate_limit_exceeded' }, { status: 429, headers: getRateLimitHeaders(limit) })
  }

  const tokenAddress = String(req.nextUrl.searchParams.get('tokenAddress') || '')
  const chainId = Number(req.nextUrl.searchParams.get('chainId') || 0)
  const usdAmount = Number(req.nextUrl.searchParams.get('usdAmount') || 0)

  if (!isAddress(tokenAddress) || !Number.isInteger(chainId) || chainId <= 0 || !Number.isFinite(usdAmount) || usdAmount <= 0 || usdAmount > 1_000_000_000) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 })
  }

  const price = await getTokenPriceUsd(tokenAddress, chainId)
  if (!price) return NextResponse.json({ error: 'price_not_found' }, { status: 404 })
  const decimals = await getTokenDecimals(tokenAddress, chainId)
  if (decimals == null) return NextResponse.json({ error: 'token_decimals_not_found' }, { status: 404 })

  const tokenAmount = await usdToTokenAmount(usdAmount, tokenAddress, chainId, decimals)
  const formatted = new BigNumber(tokenAmount.toString()).dividedBy(new BigNumber(10).pow(decimals)).toFixed(decimals).replace(/\.?0+$/, '')

  return NextResponse.json({
    tokenAmount: tokenAmount.toString(),
    tokenAmountFormatted: formatted,
    priceUsd: price,
    decimals,
  }, { headers: getRateLimitHeaders(limit) })
}
