import { NextResponse } from 'next/server';

export function middleware() {
  // Public-first browsing: no forced first-visit auth redirect.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
};
