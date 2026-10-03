import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { credit_deposits } from '@/lib/schema'
import { createDeposit, confirmDeposit, depositView } from '@/lib/account-credit'
import { walletPrincipal, walletError } from '@/lib/wallet-api'
import { requireNewPaymentsOpen } from '@/lib/payment-control'

export const dynamic = 'force-dynamic'
const create = z.object({ amount_minor: z.number().int().min(1).max(100_000), payer: z.string().regex(/^0x[a-fA-F0-9]{40}$/), client_reference: z.string().min(8).max(160) }).strict()
const confirm = z.object({ id: z.string().min(1).max(100), tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/), signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/) }).strict()
export async function GET(request: NextRequest) {
  try {
    const principal = await walletPrincipal(request)
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const id = request.nextUrl.searchParams.get('id')
    const rows = await db.select().from(credit_deposits).where(and(eq(credit_deposits.user_id, principal.userId), id ? eq(credit_deposits.id, id) : undefined)).orderBy(desc(credit_deposits.created_at)).limit(id ? 1 : 20)
    return NextResponse.json({ deposits: rows.map(row => depositView(row)) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return walletError(error) }
}
export async function POST(request: NextRequest) {
  try {
    const principal = await walletPrincipal(request, true)
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = create.safeParse(await request.json().catch(() => null))
    if (!input.success) return NextResponse.json({ error: 'Expected whole cents, a payer wallet and a stable client_reference' }, { status: 400 })
    await requireNewPaymentsOpen()
    return NextResponse.json({ deposit: await createDeposit(principal.userId, input.data) })
  } catch (error) { return walletError(error) }
}
export async function PUT(request: NextRequest) {
  try {
    const principal = await walletPrincipal(request, true)
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = confirm.safeParse(await request.json().catch(() => null))
    if (!input.success) return NextResponse.json({ error: 'Expected deposit ID, original transaction hash and payer signature' }, { status: 400 })
    // Recovery continues while new payment starts are paused and after intent expiry.
    return NextResponse.json({ deposit: await confirmDeposit(principal.userId, { ...input.data, tx_hash: input.data.tx_hash as `0x${string}`, signature: input.data.signature as `0x${string}` }) })
  } catch (error) { return walletError(error) }
}
