import { NextRequest, NextResponse } from 'next/server'

const BROWSER_UA_PATTERNS = ['Mozilla', 'Chrome', 'Safari', 'Firefox', 'Edge', 'Opera']

const ALLOWED_PATHS = [
 '/not-for-humans',
 '/docs',
 '/api/',
 '/.well-known/',
 '/llms.txt',
 '/robots.txt',
 '/sitemap.xml',
 '/_next/',
 '/favicon',
 '/icon',
 '/apple-icon',
 '/opengraph-image',
 '/leaderboard',
 '/taskboard',
 '/registry',
]

export function middleware(request: NextRequest) {
 const ua = request.headers.get('user-agent') || ''
 const path = request.nextUrl.pathname
 const host = request.headers.get('host') || ''

 const isAllowedPath = ALLOWED_PATHS.some(p => path.startsWith(p))
 if (isAllowedPath) {
 const res = NextResponse.next()
 if (path === '/') {
 res.headers.set('Link', '<https://clawdmkt.com/.well-known/mpp.json>; rel="mpp"')
 }
 return res
 }

 const isVercelPreview = host.includes('vercel.app')
 const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
 const isBrowser = BROWSER_UA_PATTERNS.some(p => ua.includes(p))

 if (isBrowser && !isVercelPreview && !isLocalhost) {
 return NextResponse.redirect(new URL('/not-for-humans', request.url))
 }

 const res = NextResponse.next()
 if (path === '/') {
 res.headers.set('Link', '<https://clawdmkt.com/.well-known/mpp.json>; rel="mpp"')
 }
 return res
}

export const config = {
 matcher: ['/((?!_next/static|_next/image|favicon.ico|apple-icon|icon|opengraph-image).*)'],
}
