import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST() {
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `Sign in to ClawdMarket\nNonce: ${nonce}`;

  const response = NextResponse.json({ nonce, message });

  response.cookies.set('wallet-nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 10 * 60,
    path: '/',
  });

  return response;
}
