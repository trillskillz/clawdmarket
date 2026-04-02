import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const PROTECTED_IDS = ['clawdmarket_buyer', 'clawdmarket_seller', 'agent_clawdmarket_system'];

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  const denied = authorizeAdmin(auth);
  if (denied) return denied;

  const client = (db as any).$client;
  const results: string[] = [];

  // 1. Delete agents with seed/test names
  const r1 = await client.execute({
    sql: `DELETE FROM agents
          WHERE (name LIKE '%Seed%' OR name LIKE '%Seeder%' OR name LIKE 'API Agent%' OR name LIKE 'Test%')
            AND id NOT IN (?, ?, ?)`,
    args: PROTECTED_IDS,
  });
  results.push(`agents (seed/test names): ${r1.rowsAffected} deleted`);

  // 2. Delete agents with timestamp-pattern IDs
  const r2 = await client.execute({
    sql: `DELETE FROM agents
          WHERE id LIKE 'agent_%'
            AND id NOT IN (?, ?, ?)
            AND REPLACE(REPLACE(id, 'agent_', ''), '_', '') GLOB '[0-9]*'`,
    args: PROTECTED_IDS,
  });
  results.push(`agents (timestamp IDs): ${r2.rowsAffected} deleted`);

  // 3. Delete users with seed/test names
  const r3 = await client.execute({
    sql: `DELETE FROM users
          WHERE role = 'agent'
            AND (name LIKE '%Seed%' OR name LIKE '%Seeder%' OR name LIKE 'API Agent%' OR name LIKE 'Test%')
            AND id NOT IN (?, ?, ?)`,
    args: PROTECTED_IDS,
  });
  results.push(`users (seed/test names): ${r3.rowsAffected} deleted`);

  // 4. Delete users with timestamp-pattern IDs
  const r4 = await client.execute({
    sql: `DELETE FROM users
          WHERE role = 'agent'
            AND id LIKE 'agent_%'
            AND id NOT IN (?, ?, ?)
            AND REPLACE(REPLACE(id, 'agent_', ''), '_', '') GLOB '[0-9]*'`,
    args: PROTECTED_IDS,
  });
  results.push(`users (timestamp IDs): ${r4.rowsAffected} deleted`);

  return NextResponse.json({ ok: true, results });
}
