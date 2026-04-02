import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, decodeEventLog, http, parseAbiItem } from 'viem'
import { arbitrum, avalanche, base, bsc, mainnet, optimism, polygon } from 'viem/chains'
import { db } from '@/lib/db'
import { payment_receipts } from '@/lib/schema'
import { getTokenPriceUsd } from '@/lib/universal-payment'

export const dynamic = 'force-dynamic'

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const TREASURY = (process.env.TREASURY_ADDRESS || process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '').toLowerCase()

const chainMap = {
  1: mainnet,
  137: polygon,
  56: bsc,
  43114: avalanche,
  42161: arbitrum,
  10: optimism,
  8453: base,
} as const

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { txHash, chainId, tokenAddress, route, amountUsd } = body || {}

    if (!txHash || !chainId || !tokenAddress || !route || !amountUsd) {
      return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
    }

    const chain = chainMap[Number(chainId) as keyof typeof chainMap]
    if (!chain) return NextResponse.json({ error: 'unsupported_chain' }, { status: 400 })

    const client = createPublicClient({ chain, transport: http() })
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })
    if (receipt.status !== 'success') return NextResponse.json({ error: 'tx_failed' }, { status: 400 })

    const expectedMinUsd = Number(amountUsd) * 0.95
    let paidEnough = false
    let usdValue = 0

    if (tokenAddress === 'native' || tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      const tx = await client.getTransaction({ hash: txHash as `0x${string}` })
      if (!tx.to || tx.to.toLowerCase() !== TREASURY) {
        return NextResponse.json({ error: 'wrong_recipient' }, { status: 400 })
      }

      const nativePrice = await getTokenPriceUsd('native', Number(chainId))
      if (!nativePrice) return NextResponse.json({ error: 'price_not_found' }, { status: 404 })
      usdValue = (Number(tx.value) / 1e18) * nativePrice
      paidEnough = usdValue >= expectedMinUsd
    } else {
      const tokenPrice = await getTokenPriceUsd(String(tokenAddress), Number(chainId))
      if (!tokenPrice) return NextResponse.json({ error: 'price_not_found' }, { status: 404 })

      let tokenAmount = BigInt(0)
      for (const log of receipt.logs) {
        try {
          const parsed = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics })
          const to = String((parsed.args as any).to || '').toLowerCase()
          if (to === TREASURY) tokenAmount += BigInt((parsed.args as any).value || 0)
        } catch {
          // ignore non-transfer logs
        }
      }

      usdValue = (Number(tokenAmount) / 1e18) * tokenPrice
      paidEnough = usdValue >= expectedMinUsd
    }

    if (!paidEnough) {
      return NextResponse.json({ error: 'insufficient_payment', usdValue, expectedMinUsd }, { status: 400 })
    }

    const [saved] = await db
      .insert(payment_receipts)
      .values({
        route: String(route),
        amount: Number(amountUsd),
        currency: String(tokenAddress),
        tx_hash: String(txHash),
        token_address: String(tokenAddress),
        chain_id: Number(chainId),
        usd_value_at_payment: Number(usdValue.toFixed(6)),
      })
      .returning({ id: payment_receipts.id })

    return NextResponse.json({ ok: true, receipt_id: saved?.id, txHash })
  } catch (error: any) {
    return NextResponse.json({ error: 'verification_failed', detail: error?.message || 'unknown' }, { status: 400 })
  }
}
