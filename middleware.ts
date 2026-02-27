import { NextRequest, NextResponse } from 'next/server';

const FIRST_VISIT_COOKIE = 'cm_seen_join';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublicAsset =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/images') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml';

  if (isPublicAsset) return NextResponse.next();

  const alreadySeenJoin = req.cookies.get(FIRST_VISIT_COOKIE)?.value === '1';
  const alreadyOnJoinFlow = pathname.startsWith('/auth/register');
  const hasAuthToken = Boolean(req.cookies.get('auth-token')?.value);

  if (!hasAuthToken && !alreadySeenJoin && !alreadyOnJoinFlow && req.method === 'GET') {
    const url = req.nextUrl.clone();
    url.pathname = '/auth/register';
    url.searchParams.set('first_visit', '1');

    const res = NextResponse.redirect(url);
    res.cookies.set(FIRST_VISIT_COOKIE, '1', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: false,
    });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
};
