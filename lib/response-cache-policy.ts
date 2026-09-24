const ALWAYS_PRIVATE_PREFIXES = [
  '/api/admin',
  '/api/auth',
  '/api/claim',
  '/api/contracts/maintenance',
  '/api/cron',
  '/api/messages',
  '/api/trades',
  '/api/webhooks',
  '/api/watchlist',
  '/api/work',
] as const

const ALWAYS_PRIVATE_ROUTES = new Set([
  '/api/agent/self-test',
  '/api/agent/session',
  '/api/a2a',
  '/api/agents/register',
  '/api/payments/payout-address',
  '/api/wallet',
])

const CREDENTIAL_HEADERS = [
  'authorization',
  'x-agent-api-key',
  'x-clawdmarket-agent-key',
  'x-csrf-token',
  'x-maintenance-secret',
] as const

export function shouldDisableSharedCaching(
  pathname: string,
  headers: Pick<Headers, 'has'>,
  hasAuthCookie: boolean,
) {
  if (hasAuthCookie || CREDENTIAL_HEADERS.some((name) => headers.has(name))) return true
  if (ALWAYS_PRIVATE_ROUTES.has(pathname)) return true
  return ALWAYS_PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
