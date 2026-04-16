import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET || '')

function nextWithDiscoveryHeaders() {
  const response = NextResponse.next()
  response.headers.set('X-Agent-Discovery', 'https://clawdmkt.com/llms.txt')
  response.headers.set('X-MPP-Descriptor', 'https://clawdmkt.com/.well-known/mpp.json')
  response.headers.set('X-Agent-Card', 'https://clawdmkt.com/.well-known/agent.json')
  response.headers.set('X-Agent-Manifest', 'https://clawdmkt.com/.well-known/clawdmarket.json')
  response.headers.set('X-MCP-Server', 'https://clawdmkt.com/api/mcp')
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, WWW-Authenticate')
  return response
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  if (path.startsWith('/dashboard')) {
    const token = request.cookies.get('auth-token')?.value
    if (!token) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    try {
      const { payload } = await jwtVerify(token, jwtSecret)

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

  return nextWithDiscoveryHeaders()
}

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico|apple-icon|icon|opengraph-image).*)',
  ],
}
