import { NextRequest, NextResponse } from 'next/server'

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

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  if (path === '/') {
    return NextResponse.redirect(new URL('/not-for-humans', request.url))
  }

  return nextWithDiscoveryHeaders()
}

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico|apple-icon|icon|opengraph-image).*)',
  ],
}
