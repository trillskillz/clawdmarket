import { NextRequest, NextResponse } from 'next/server';
import { validateCsrf } from '@/lib/csrf';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Validate CSRF
  if (!validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  const response = NextResponse.json({
    message: 'Logged out successfully',
  });

  // Clear auth cookie
  response.cookies.set('auth-token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });

  // Clear CSRF cookie
  response.cookies.set('csrf-token', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });

  return response;
}
