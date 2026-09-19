import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { agents } from '@/lib/schema';
import {
  ensureSyntheticAgentUser,
  resolveRegisteredAgentRequest,
  type RegisteredAgentAuth,
} from '@/lib/registered-agent-auth';

function verifiedMppPayer(req: NextRequest): string | null {
  const receipt = (req as any).mppReceipt;
  const raw = receipt?.payer || receipt?.payerAddress || receipt?.from || receipt?.account;
  if (typeof raw !== 'string') return null;
  const match = raw.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0].toLowerCase() : null;
}

export type RequestPrincipal = {
  userId: string;
  agentId: string | null;
  kind: 'account' | 'registered-agent' | 'mpp';
  usesCookieAuth: boolean;
};

function asRegisteredAgent(row: { id: string; name: string }): Extract<RegisteredAgentAuth, { kind: 'agent' }> {
  return {
    kind: 'agent',
    agentId: row.id,
    name: row.name,
    syntheticUserId: `user_agent_${row.id}`,
    status: 'active',
    credential: 'current',
  };
}

export async function resolveRequestPrincipal(req: NextRequest): Promise<RequestPrincipal | null> {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const accountFromHeader = authHeader ? await authenticateRequest(authHeader) : null;
  const accountFromCookie = !accountFromHeader && cookieToken
    ? await authenticateRequest(`Bearer ${cookieToken}`)
    : null;
  const account = accountFromHeader || accountFromCookie;

  if (account) {
    return {
      userId: account.userId,
      agentId: account.userId.startsWith('user_agent_') ? account.userId.slice('user_agent_'.length) : null,
      kind: 'account',
      // A syntactically present but invalid Authorization header must not turn
      // a cookie-authenticated request into a CSRF-exempt bearer request.
      usesCookieAuth: Boolean(accountFromCookie),
    };
  }

  const registered = await resolveRegisteredAgentRequest(req);
  if (registered.kind === 'agent') {
    await ensureSyntheticAgentUser(registered);
    return {
      userId: registered.syntheticUserId,
      agentId: registered.agentId,
      kind: 'registered-agent',
      usesCookieAuth: false,
    };
  }

  // Only trust payer data attached by the MPP middleware after verification.
  // Parsing a credential header alone does not prove that it is valid.
  const payer = verifiedMppPayer(req);
  if (!payer) return null;

  const [row] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(sql`LOWER(${agents.owner_address}) = ${payer}`)
    .limit(1);
  if (!row) {
    const userId = `user_wallet_${payer.slice(2)}`;
    const nowIso = new Date().toISOString();
    await (db as any).$client.execute({
      sql: `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, bio, created_at)
            VALUES (?, ?, ?, ?, 'agent', ?, ?)`,
      args: [
        userId,
        `wallet_${payer}@wallet.local`,
        crypto.randomUUID(),
        `MPP_${payer.slice(2, 8)}`,
        `MPP payer ${payer}`,
        nowIso,
      ],
    });
    await (db as any).$client.execute({
      sql: `INSERT OR IGNORE INTO wallets (user_id, balance, escrow, created_at) VALUES (?, 0, 0, ?)`,
      args: [userId, nowIso],
    });
    return { userId, agentId: null, kind: 'mpp', usesCookieAuth: false };
  }

  const payerAgent = asRegisteredAgent(row);
  await ensureSyntheticAgentUser(payerAgent);
  return {
    userId: payerAgent.syntheticUserId,
    agentId: payerAgent.agentId,
    kind: 'mpp',
    usesCookieAuth: false,
  };
}
