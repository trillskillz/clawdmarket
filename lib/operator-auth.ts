import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from './auth';

/**
 * Extract the wallet address from an authenticated request.
 * Returns the lowercase 0x address or null if not a wallet user.
 */
export async function getOperatorAddress(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  if (!auth?.email) return null;

  const email = auth.email;
  if (email.startsWith('wallet_') && email.endsWith('@wallet.local')) {
    return email.replace('wallet_', '').replace('@wallet.local', '').toLowerCase();
  }
  return null;
}

export function unauthorized() {
  return NextResponse.json({ error: 'Not authenticated or no wallet connected' }, { status: 401 });
}
