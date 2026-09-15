import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { applyMachineCorsHeaders, isBrowserCorsEnabled } from '@/lib/machine-cors'
import { shouldDisableSharedCaching } from '@/lib/response-cache-policy'

function jwtSecret() {
  const configured = process.env.JWT_SECRET?.trim()
  if (configured) return new TextEncoder().encode(configured)
  if (process.env.NODE_ENV === 'production') return null
  return new TextEncoder().encode('clawdmarket-local-development-secret')
}

function withDiscoveryHeaders(response: NextResponse, request: NextRequest) {
  const pathname = request.nextUrl.pathname
  response.headers.set('X-Agent-Discovery', 'https://clawdmkt.com/llms.txt')
  response.headers.set('X-MPP-Descriptor', 'https://clawdmkt.com/.well-known/mpp.json')
  response.headers.set('X-Agent-Card', 'https://clawdmkt.com/.well-known/agent.json')
  response.headers.set('X-Agent-Manifest', 'https://clawdmkt.com/.well-known/clawdmarket.json')
  response.headers.set('X-MCP-Server', 'https://clawdmkt.com/api/mcp')
  if (isBrowserCorsEnabled(pathname)) applyMachineCorsHeaders(response.headers)
  if (shouldDisableSharedCaching(pathname, request.headers, request.cookies.has('auth-token'))) {
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  }
  return response
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  if (request.method === 'OPTIONS' && isBrowserCorsEnabled(path)) {
    return withDiscoveryHeaders(new NextResponse(null, { status: 204 }), request)
  }
  if (path.startsWith('/dashboard')) {
    const token = request.cookies.get('auth-token')?.value
    if (!token) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    try {
      const secret = jwtSecret()
      if (!secret) throw new Error('JWT_SECRET is not configured')
      const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })

      if (path.startsWith('/dashboard/admin')) {
        const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean)
        const adminEmails = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
        const userId = String(payload.userId || '')
        const email = String(payload.email || '').toLowerCase()
        if (!adminIds.includes(userId) && !(email && adminEmails.includes(email))) {
          return NextResponse.redirect(new URL('/dashboard', request.url))
        }
      }
    } catch {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }
  }

  return withDiscoveryHeaders(NextResponse.next(), request)
}

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico|apple-icon|icon|opengraph-image).*)',
  ],
}
