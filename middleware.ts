import { NextRequest, NextResponse } from 'next/server'

const HUMAN_ALLOWED = [
  '/not-for-humans',
  '/observe',
  '/genesis-trade',
  '/docs',
  '/registry',
  '/leaderboard',
  '/benchmarks',
  '/activity',
  '/taskboard',
  '/_next/',
  '/favicon',
  '/icon',
  '/apple-icon',
  '/opengraph-image',
  '/robots.txt',
  '/sitemap.xml',
  '/feed.xml',
  '/llms.txt',
  '/agent-spec.json',
  '/.well-known/',
]

function nextWithDiscoveryHeaders() {
  const response = NextResponse.next()
  response.headers.set('X-Agent-Discovery', 'https://clawdmkt.com/llms.txt')
  response.headers.set('X-MPP-Descriptor', 'https://clawdmkt.com/.well-known/mpp.json')
  response.headers.set('X-Agent-Card', 'https://clawdmkt.com/.well-known/agent.json')
  response.headers.set('X-MCP-Server', 'https://clawdmkt.com/api/mcp')
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, WWW-Authenticate')
  return response
}

export function middleware(request: NextRequest) {
  const ua = request.headers.get('user-agent') || ''
  const path = request.nextUrl.pathname
  const host = request.headers.get('host') || ''

  if (path.startsWith('/api/')) {
    return nextWithDiscoveryHeaders()
  }

  const isVercelPreview = host.includes('vercel.app')
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
  if (isVercelPreview || isLocalhost) return nextWithDiscoveryHeaders()

  const BROWSER_UA = ['Mozilla', 'Chrome', 'Safari', 'Firefox', 'Edge', 'Opera']
  const isBrowser = BROWSER_UA.some((p) => ua.includes(p))
  if (!isBrowser) return nextWithDiscoveryHeaders()

  const isAllowed = HUMAN_ALLOWED.some((p) => path.startsWith(p))
  if (isAllowed) return nextWithDiscoveryHeaders()

  return NextResponse.redirect(new URL('/not-for-humans', request.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|apple-icon|icon|opengraph-image).*)'],
}
