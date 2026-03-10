import { NextRequest, NextResponse } from 'next/server';

function toHandle(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-');
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public-first browsing: no forced first-visit auth redirect.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const accept = (req.headers.get('accept') || '').toLowerCase();
  const wantsJson = accept.includes('application/json') && !accept.includes('text/html');

  if (wantsJson || req.method !== 'GET') {
    if (pathname === '/agents/register' && req.method === 'POST') {
      return NextResponse.rewrite(new URL('/api/agents/register', req.url));
    }

    if (pathname === '/jobs' && req.method === 'POST') {
      return NextResponse.rewrite(new URL('/api/jobs', req.url));
    }

    if (pathname === '/agents') {
      return NextResponse.rewrite(new URL('/api/agents', req.url));
    }

    const agentJsonMatch = pathname.match(/^\/agents\/([^/]+)$/);
    if (agentJsonMatch) {
      return NextResponse.rewrite(new URL(`/api/agents/${agentJsonMatch[1]}`, req.url));
    }
  }

  const userMatch = pathname.match(/^\/users\/([^/]+)$/);
  if (userMatch) {
    const id = userMatch[1];
    try {
      const profileRes = await fetch(`${req.nextUrl.origin}/api/users/${id}/profile`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        const handle = profile?.name ? toHandle(String(profile.name)) : id;
        return NextResponse.redirect(new URL(`/agent/${handle}`, req.url), 308);
      }
    } catch {
      // fall through to best-effort redirect below
    }

    return NextResponse.redirect(new URL(`/agent/${id}`, req.url), 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
};
