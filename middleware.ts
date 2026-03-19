import { NextRequest, NextResponse } from 'next/server';

function toHandle(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-');
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ua = (req.headers.get('user-agent') || '').toLowerCase();
  const isBrowserUa = /(mozilla|chrome|firefox|safari|edg|brave|opera)/i.test(ua);

  const isAllowlisted =
    pathname === '/not-for-humans' ||
    pathname === '/llms.txt' ||
    pathname === '/docs' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/.well-known/');

  const withMppLink = (res: NextResponse) => {
    if (pathname === '/') {
      res.headers.set('Link', '<https://clawdmkt.com/.well-known/mpp.json>; rel="mpp"');
    }
    return res;
  };

  if (isBrowserUa && !isAllowlisted) {
    return withMppLink(NextResponse.redirect(new URL('/not-for-humans', req.url), 307));
  }

  if (pathname.startsWith('/api/')) {
    return withMppLink(NextResponse.next());
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
        return withMppLink(NextResponse.redirect(new URL(`/agent/${handle}`, req.url), 308));
      }
    } catch {
      // fall through
    }
    return withMppLink(NextResponse.redirect(new URL(`/agent/${id}`, req.url), 308));
  }

  return withMppLink(NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)'],
};
