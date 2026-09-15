import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyMessage, isAddress, isHex } from 'viem';
import { db } from '@/lib/db';
import { users, wallet_auth_nonces, wallets } from '@/lib/schema';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { generateJWT, hashPassword } from '@/lib/auth';
import { generateCsrfToken } from '@/lib/csrf';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { isIpBlacklisted, isUserBanned, trackUserIp } from '@/lib/agent-moderation';
import { getRequestIp } from '@/lib/request-ip';
import { createWalletAuthChallenge, hashWalletAuthNonce } from '@/lib/wallet-auth';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = getRequestIp(req);
  if (await isIpBlacklisted(ip)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const rl = await rateLimit(`wallet-verify:${ip}`, { interval: 60_000, maxRequests: 20, failClosed: true });

  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: getRateLimitHeaders(rl) });
  }

  try {
    const body = await req.json();
    const address = String(body?.address ?? '').toLowerCase();
    const signature = String(body?.signature ?? '');
    const nonce = String(body?.nonce ?? '');

    if (!address || !signature || !nonce) {
      return NextResponse.json({ error: 'Missing wallet auth fields' }, { status: 400, headers: getRateLimitHeaders(rl) });
    }

    if (!isAddress(address as `0x${string}`)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400, headers: getRateLimitHeaders(rl) });
    }

    if (nonce.length < 8 || nonce.length > 128) {
      return NextResponse.json({ error: 'Invalid nonce' }, { status: 400, headers: getRateLimitHeaders(rl) });
    }

    if (!isHex(signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400, headers: getRateLimitHeaders(rl) });
    }

    const now = Date.now();
    const nonceHash = hashWalletAuthNonce(nonce);
    const [challenge] = await db.select().from(wallet_auth_nonces)
      .where(and(
        eq(wallet_auth_nonces.nonce_hash, nonceHash),
        eq(wallet_auth_nonces.address, address),
        isNull(wallet_auth_nonces.consumed_at),
        gt(wallet_auth_nonces.expires_at, now),
      ))
      .limit(1);
    if (!challenge) {
      return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 401 });
    }

    const { message } = createWalletAuthChallenge({
      address: challenge.address,
      chainId: challenge.chain_id,
      origin: `${new URL(challenge.uri).protocol}//${challenge.domain}`,
      nonce,
      issuedAt: new Date(challenge.issued_at),
      expiresAt: new Date(challenge.expires_at),
    });
    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    }).catch(() => false);

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const consumed = await db.update(wallet_auth_nonces)
      .set({ consumed_at: now })
      .where(and(
        eq(wallet_auth_nonces.nonce_hash, nonceHash),
        eq(wallet_auth_nonces.address, address),
        isNull(wallet_auth_nonces.consumed_at),
        gt(wallet_auth_nonces.expires_at, now),
      ))
      .returning({ nonceHash: wallet_auth_nonces.nonce_hash });
    if (consumed.length !== 1) {
      return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 401 });
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
        .onConflictDoNothing({ target: users.email })
        .returning();

      user = inserted[0];

      // Another request for the same wallet can win the insert race. In that
      // case, use the account it created instead of turning a valid signature
      // into a 500 response.
      if (!user) {
        [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, syntheticEmail));
      }
    }

    if (!user) {
      throw new Error('Wallet account could not be created');
    }

    await db.insert(wallets).values({ user_id: user.id, balance: 0, escrow: 0 }).onConflictDoNothing();

    if (await isUserBanned(user.id)) {
      return NextResponse.json({ error: 'Account banned' }, { status: 403 });
    }

    await trackUserIp(user.id, ip);

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

    return response;
  } catch (error) {
    console.error('Wallet verify error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
