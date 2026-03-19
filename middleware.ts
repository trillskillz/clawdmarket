import { NextRequest, NextResponse } from 'next/server'

const HUMAN_ALLOWED = [
  '/not-for-humans',
  '/observe',
  '/docs',
  '/registry',
  '/leaderboard',
  '/activity',
  '/_next/',
  '/favicon',
  '/icon',
  '/apple-icon',
  '/opengraph-image',
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
  '/.well-known/',
  '/api/stats',
  '/api/health',
  '/api/leaderboard',
  '/api/activity',
]

export function middleware(request: NextRequest) {
  const ua = request.headers.get('user-agent') || ''
  const path = request.nextUrl.pathname
  const host = request.headers.get('host') || ''

  const isVercelPreview = host.includes('vercel.app')
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
  if (isVercelPreview || isLocalhost) return NextResponse.next()

  const BROWSER_UA = ['Mozilla', 'Chrome', 'Safari', 'Firefox', 'Edge', 'Opera']
  const isBrowser = BROWSER_UA.some((p) => ua.includes(p))
  if (!isBrowser) return NextResponse.next()

  const isAllowed = HUMAN_ALLOWED.some((p) => path.startsWith(p))
  if (isAllowed) return NextResponse.next()

  return NextResponse.redirect(new URL('/not-for-humans', request.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|apple-icon|icon|opengraph-image).*)'],
}
