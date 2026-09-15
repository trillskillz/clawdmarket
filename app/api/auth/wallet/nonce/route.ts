import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { getRequestIp } from '@/lib/request-ip';
import { db } from '@/lib/db';
import { wallet_auth_nonces } from '@/lib/schema';
import { lt } from 'drizzle-orm';
import { createWalletAuthChallenge, hashWalletAuthNonce, walletAuthOrigin } from '@/lib/wallet-auth';
import { internalErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic'

function requestOrigin(req: NextRequest) {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',', 1)[0]?.trim()
  const host = forwardedHost || req.headers.get('host')?.trim()
  const forwardedProtocol = req.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim()
  const protocol = forwardedProtocol || req.nextUrl.protocol.slice(0, -1)
  return host && (protocol === 'http' || protocol === 'https')
    ? `${protocol}://${host}`
    : req.nextUrl.origin
}

export async function POST(req: NextRequest) {
  const ip = getRequestIp(req);
  const rl = await rateLimit(`wallet-nonce:${ip}`, { interval: 60_000, maxRequests: 30, failClosed: true });

  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: getRateLimitHeaders(rl) });
  }

  const body = await req.json().catch(() => null);
  const address = String(body?.address || '').trim();
  const chainId = Number(body?.chainId);
  let challenge;
  try {
    challenge = createWalletAuthChallenge({
      address,
      chainId,
      origin: walletAuthOrigin(requestOrigin(req)),
    });
  } catch {
    return NextResponse.json(
      { error: 'A valid wallet address and EVM chain ID are required' },
      { status: 400, headers: getRateLimitHeaders(rl) },
    );
  }

  try {
    const now = Date.now();
    await db.delete(wallet_auth_nonces).where(lt(wallet_auth_nonces.expires_at, now - 24 * 60 * 60 * 1000));
    await db.insert(wallet_auth_nonces).values({
      nonce_hash: hashWalletAuthNonce(challenge.nonce),
      address: challenge.address.toLowerCase(),
      chain_id: challenge.chainId,
      domain: challenge.domain,
      uri: challenge.uri,
      issued_at: challenge.issuedAt.getTime(),
      expires_at: challenge.expiresAt.getTime(),
    });
  } catch (error) {
    const response = internalErrorResponse('Wallet challenge creation failed', error, {
      code: 'wallet_challenge_unavailable',
      message: 'Wallet sign-in is temporarily unavailable. Please try again.',
      status: 503,
    });
    response.headers.set('Cache-Control', 'no-store');
    for (const [name, value] of Object.entries(getRateLimitHeaders(rl))) {
      response.headers.set(name, value);
    }
    return response;
  }

  return NextResponse.json({
    nonce: challenge.nonce,
    message: challenge.message,
    expiresAt: challenge.expiresAt.toISOString(),
  }, {
    headers: { ...getRateLimitHeaders(rl), 'Cache-Control': 'no-store' },
  });
}
