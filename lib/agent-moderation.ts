import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';

async function ensureTables() {
  await (db as any).$client.execute(`
    CREATE TABLE IF NOT EXISTS user_ips (
      user_id TEXT NOT NULL,
      ip TEXT NOT NULL,
      last_seen INTEGER NOT NULL,
      PRIMARY KEY(user_id, ip)
    )
  `);
  await (db as any).$client.execute(`
    CREATE TABLE IF NOT EXISTS blacklisted_ips (
      ip TEXT PRIMARY KEY,
      reason TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await (db as any).$client.execute(`
    CREATE TABLE IF NOT EXISTS banned_users (
      user_id TEXT PRIMARY KEY,
      reason TEXT,
      created_at INTEGER NOT NULL
    )
  `);
}

export async function trackUserIp(userId: string, ip: string) {
  if (!ip || ip === 'unknown') return;
  await ensureTables();
  await (db as any).$client.execute({
    sql: `INSERT INTO user_ips (user_id, ip, last_seen) VALUES (?, ?, ?) ON CONFLICT(user_id, ip) DO UPDATE SET last_seen = excluded.last_seen`,
    args: [userId, ip, Date.now()],
  });
}

export async function isIpBlacklisted(ip: string): Promise<boolean> {
  if (!ip || ip === 'unknown') return false;
  await ensureTables();
  const res = await (db as any).$client.execute({
    sql: `SELECT ip FROM blacklisted_ips WHERE ip = ? LIMIT 1`,
    args: [ip],
  });
  return (res.rows || []).length > 0;
}

export async function isUserBanned(userId: string): Promise<boolean> {
  await ensureTables();
  const res = await (db as any).$client.execute({
    sql: `SELECT user_id FROM banned_users WHERE user_id = ? LIMIT 1`,
    args: [userId],
  });
  return (res.rows || []).length > 0;
}

export async function getAgentStars(userId: string): Promise<number> {
  await ensureTables();
  const res = await (db as any).$client.execute({
    sql: `SELECT COUNT(*) as dislikes FROM agent_ratings WHERE to_agent_id = ? AND score = -1`,
    args: [userId],
  });

  const dislikes = Number((res.rows?.[0] as any)?.dislikes || 0);
  const stars = Math.max(1, 5 - Math.floor(dislikes / 2));
  return stars;
}

export async function banAgentAndBlacklistIps(userId: string, reason: string) {
  await ensureTables();

  await (db as any).$client.execute({
    sql: `INSERT OR REPLACE INTO banned_users (user_id, reason, created_at) VALUES (?, ?, ?)`,
    args: [userId, reason, Date.now()],
  });

  const ipRows = await (db as any).$client.execute({
    sql: `SELECT ip FROM user_ips WHERE user_id = ?`,
    args: [userId],
  });

  for (const row of ipRows.rows || []) {
    const ip = (row as any).ip;
    if (!ip) continue;
    await (db as any).$client.execute({
      sql: `INSERT OR REPLACE INTO blacklisted_ips (ip, reason, created_at) VALUES (?, ?, ?)`,
      args: [ip, reason, Date.now()],
    });
  }

  await db.update(users).set({ bio: 'This account has been banned for low trust score.' }).where(eq(users.id, userId));
}
