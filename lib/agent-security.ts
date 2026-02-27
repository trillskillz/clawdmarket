import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from './db';
import { agent_instruction_nonces, agent_sessions } from './schema';
import { and, eq } from 'drizzle-orm';
import { envMeta } from './agent-environment';

const MAX_SKEW_MS = 60_000;

export function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export async function validateAgentInstruction(req: NextRequest, userId: string, authHeader: string | null) {
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const isApiKeyAuth = token.startsWith('clawd_');

  if (!isApiKeyAuth) return null;

  const nonce = req.headers.get('x-agent-nonce');
  const tsRaw = req.headers.get('x-agent-timestamp');

  if (!nonce || !tsRaw) {
    return NextResponse.json(
      { error: 'Missing agent replay-protection headers', code: 'REPLAY_PROTECTION_REQUIRED', ...envMeta('clawdmarket/lib/agent-security') },
      { status: 400 }
    );
  }

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) {
    return NextResponse.json(
      { error: 'Invalid x-agent-timestamp', code: 'INVALID_TIMESTAMP', ...envMeta('clawdmarket/lib/agent-security') },
      { status: 400 }
    );
  }

  if (Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
    return NextResponse.json(
      { error: 'Request timestamp outside allowed skew window', code: 'STALE_INSTRUCTION', ...envMeta('clawdmarket/lib/agent-security') },
      { status: 409 }
    );
  }

  try {
    await db.insert(agent_instruction_nonces).values({
      id: `${userId}:${nonce}`,
      user_id: userId,
      nonce,
    });
  } catch {
    return NextResponse.json(
      { error: 'Replay detected (nonce already used)', code: 'REPLAY_DETECTED', ...envMeta('clawdmarket/lib/agent-security') },
      { status: 409 }
    );
  }

  const sessionId = req.headers.get('x-agent-session-id');
  const paramsHash = req.headers.get('x-agent-params-hash');
  if (sessionId || paramsHash) {
    if (!sessionId || !paramsHash) {
      return NextResponse.json(
        { error: 'Both x-agent-session-id and x-agent-params-hash are required together', code: 'SESSION_HEADER_MISMATCH', ...envMeta('clawdmarket/lib/agent-security') },
        { status: 400 }
      );
    }

    const [session] = await db
      .select()
      .from(agent_sessions)
      .where(and(eq(agent_sessions.id, sessionId), eq(agent_sessions.user_id, userId), eq(agent_sessions.status, 'active')));

    if (!session) {
      return NextResponse.json(
        { error: 'Agent session not found or inactive', code: 'SESSION_NOT_ACTIVE', ...envMeta('clawdmarket/lib/agent-security') },
        { status: 404 }
      );
    }

    if (session.declared_hash !== paramsHash) {
      return NextResponse.json(
        { error: 'Declared agent parameters deviated from session contract', code: 'COUNTERPARTY_DEVIATION', ...envMeta('clawdmarket/lib/agent-security') },
        { status: 409 }
      );
    }
  }

  return null;
}
