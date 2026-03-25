import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const clean = (value?: string) => (value || '').trim()

export async function GET() {
 return NextResponse.json({
  evm:
   clean(process.env.TREASURY_ADDRESS) ||
   clean(process.env.MPP_RECIPIENT_ADDRESS) ||
   '0x3E911a2EaFbE60ca538F659836d6DE60Db639D44',
  mpp:
   clean(process.env.MPP_RECIPIENT_ADDRESS) ||
   '0x3E911a2EaFbE60ca538F659836d6DE60Db639D44',
  solana:
   clean(process.env.SOLANA_RECIPIENT_ADDRESS) ||
   clean(process.env.NEXT_PUBLIC_SOLANA_RECIPIENT_ADDRESS) ||
   '6yVHdDNi9X3BqiQx9VxVfeutxoeaRFhHnQzXF1YQ2fz7',
  bitcoin:
   clean(process.env.BITCOIN_RECIPIENT_ADDRESS) ||
   clean(process.env.NEXT_PUBLIC_BITCOIN_RECIPIENT_ADDRESS) ||
   'bc1qetkagszgdst37k30h4r4x6e2sjnkqds92jkwmv',
  kaspa:
   clean(process.env.KASPA_RECIPIENT_ADDRESS) ||
   'kaspa:qrjhg5pvhm3ljupk4pl5k5wfd86kpc98wwk26jksruevq8g9zq5lucfqk23vg',
  litecoin:
   clean(process.env.LITECOIN_RECIPIENT_ADDRESS) ||
   'ltc1qs5699vkwyfccg4qn88sutg5ppp5gxhx2d24ls3',
  dogecoin:
   clean(process.env.DOGECOIN_RECIPIENT_ADDRESS) ||
   'DC5ozXfSZEBmJkBcSdi2kpxAgVQNTxJRM8',
 })
}
