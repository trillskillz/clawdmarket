import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyMessage } from 'viem';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { generateJWT, hashPassword } from '@/lib/auth';
import { generateCsrfToken } from '@/lib/csrf';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const address = String(body?.address ?? '').toLowerCase();
    const signature = String(body?.signature ?? '');
    const nonce = String(body?.nonce ?? '');

    if (!address || !signature || !nonce) {
      return NextResponse.json({ error: 'Missing wallet auth fields' }, { status: 400 });
    }

    const cookieNonce = req.cookies.get('wallet-nonce')?.value;
    if (!cookieNonce || cookieNonce !== nonce) {
      return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 401 });
    }

    const message = `Sign in to ClawdMarket\nNonce: ${nonce}`;
    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const syntheticEmail = `wallet_${address}@wallet.local`;

    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, syntheticEmail));

    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await hashPassword(randomPassword);

      const inserted = await db
        .insert(users)
        .values({
          email: syntheticEmail,
          password_hash: passwordHash,
          name: `Wallet_${address.slice(2, 8)}`,
          role: 'human',
          bio: `Wallet-auth user ${address}`,
        })
        .returning();

      user = inserted[0];
    }

    const token = generateJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const csrfToken = generateCsrfToken();

    const response = NextResponse.json({
      message: 'Wallet login successful',
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        wallet: address,
      },
    });

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600,
      path: '/',
    });

    response.cookies.set('csrf-token', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600,
      path: '/',
    });

    response.cookies.set('wallet-nonce', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Wallet verify error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
