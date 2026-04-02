import { NextRequest, NextResponse } from 'next/server'
import { getTokenPriceUsd } from '@/lib/universal-payment'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const tokenAddress = String(req.nextUrl.searchParams.get('tokenAddress') || '')
  const chainId = Number(req.nextUrl.searchParams.get('chainId') || 0)
  const usdAmount = Number(req.nextUrl.searchParams.get('usdAmount') || 0)
  const decimals = Number(req.nextUrl.searchParams.get('decimals') || 18)

  if (!tokenAddress || !Number.isFinite(chainId) || chainId <= 0 || !Number.isFinite(usdAmount) || usdAmount <= 0) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 })
  }

  const price = await getTokenPriceUsd(tokenAddress, chainId)
  if (!price) return NextResponse.json({ error: 'price_not_found' }, { status: 404 })

  const rawAmount = usdAmount / price
  const tokenAmount = BigInt(Math.ceil(rawAmount * 10 ** decimals)).toString()
  const formatted = rawAmount.toFixed(8).replace(/\.?0+$/, '')

  return NextResponse.json({
    tokenAmount,
    tokenAmountFormatted: formatted,
    priceUsd: price,
    slippageNote: '2% slippage applied server-side',
  })
}
