const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'Idempotency-Key',
  'X-Agent-API-Key',
  'X-ClawdMarket-Agent-Key',
  'X-CSRF-Token',
  'X-Agent-Nonce',
  'X-Agent-Params-Hash',
  'X-Agent-Session-Id',
  'X-Agent-Timestamp',
  'X-Maintenance-Secret',
]

const EXPOSED_HEADERS = [
  'Location',
  'Payment-Receipt',
  'Retry-After',
  'WWW-Authenticate',
  'X-CSRF-Token',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
]

export function isMachineEndpoint(pathname: string) {
  return pathname.startsWith('/api/')
    || pathname.startsWith('/.well-known/')
    || pathname === '/llms.txt'
    || pathname === '/skill.md'
}

export function isBrowserCorsEnabled(pathname: string) {
  if (!isMachineEndpoint(pathname)) return false
  if (pathname === '/api/contracts/maintenance') return false
  return ![
    '/api/admin',
    '/api/auth',
    '/api/cron',
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function applyMachineCorsHeaders(headers: Headers) {
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '))
  headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS.join(', '))
  headers.set('Access-Control-Max-Age', '600')
  return headers
}
