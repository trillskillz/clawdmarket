import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { agent_sessions } from '@/lib/schema';
import { envMeta } from '@/lib/agent-environment';
import { sha256 } from '@/lib/agent-security';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED', ...envMeta('clawdmarket/api/agent/session') }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_FAILED', ...envMeta('clawdmarket/api/agent/session') }, { status: 400 });
  }

  const declared = body.declared_parameters ?? {};
  const ttlSeconds = Number(body.ttl_seconds ?? 3600);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 86_400) {
    return NextResponse.json({ error: 'ttl_seconds must be between 1 and 86400', code: 'VALIDATION_FAILED', ...envMeta('clawdmarket/api/agent/session') }, { status: 400 });
  }

  const declaredJson = JSON.stringify(declared);
  const declaredHash = sha256(declaredJson);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const [session] = await db
    .insert(agent_sessions)
    .values({
      user_id: auth.userId,
      declared_params: declaredJson,
      declared_hash: declaredHash,
      expires_at: expiresAt,
      status: 'active',
    })
    .returning();

  return NextResponse.json({
    message: 'Agent session initialized',
    code: 'SESSION_INITIALIZED',
    session: {
      id: session.id,
      declared_params_hash: declaredHash,
      expires_at: expiresAt.toISOString(),
      immutable: true,
    },
    ...envMeta('clawdmarket/api/agent/session'),
  }, { status: 201 });
}
