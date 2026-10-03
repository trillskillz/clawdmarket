import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from './request-principal'
import { validateCsrf } from './csrf'
import { rateLimit } from './rate-limit'
import { CreditError, SettlementError } from './account-credit'
import { NewPaymentsPausedError } from './payment-control'

export async function walletPrincipal(request: NextRequest, write = false) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return null
  if (write && principal.usesCookieAuth && !validateCsrf(request)) throw new CreditError('CSRF_REQUIRED', 'CSRF validation failed', 403)
  const limited = await rateLimit(`wallet:${write ? 'write' : 'read'}:${principal.userId}`, { interval: 60_000, maxRequests: write ? 20 : 60, failClosed: true })
  if (!limited.success) throw new CreditError('RATE_LIMITED', 'Too many wallet requests', 429)
  return principal
}
export function walletError(error: unknown) {
  if (error instanceof CreditError || error instanceof NewPaymentsPausedError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  if (error instanceof SettlementError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.retryable ? 202 : 409 })
  // Database/RPC details may contain private configuration.
  return NextResponse.json({ error: 'Wallet operation could not be completed. Recover using the same reference and transaction hash.', code: 'WALLET_RETRY_REQUIRED' }, { status: 503 })
}
