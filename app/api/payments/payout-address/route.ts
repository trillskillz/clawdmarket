import { NextRequest, NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { payoutAddressForUser, recordPayoutAddress } from '@/lib/external-settlement'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ address: await payoutAddressForUser(principal.userId) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: NextRequest) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
  const body = await request.json().catch(() => null)
  const address = String(body?.address || '').trim()
  if (!isAddress(address)) return NextResponse.json({ error: 'A valid EVM payout address is required' }, { status: 400 })
  await recordPayoutAddress(principal.userId, address)
  return NextResponse.json({ ok: true, address: address.toLowerCase() })
}
