import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function trackUserIp(userId: string, ip: string) {
  if (!ip || ip === 'unknown') return;
  await (db as any).$client.execute({
    sql: `INSERT INTO user_ips (user_id, ip, last_seen) VALUES (?, ?, ?) ON CONFLICT(user_id, ip) DO UPDATE SET last_seen = excluded.last_seen`,
    args: [userId, ip, Date.now()],
  });
}

export async function isIpBlacklisted(ip: string): Promise<boolean> {
  if (!ip || ip === 'unknown') return false;
  const res = await (db as any).$client.execute({
    sql: `SELECT ip FROM blacklisted_ips WHERE ip = ? LIMIT 1`,
    args: [ip],
  });
  return (res.rows || []).length > 0;
}

export async function isUserBanned(userId: string): Promise<boolean> {
  const res = await (db as any).$client.execute({
    sql: `SELECT user_id FROM banned_users WHERE user_id = ? LIMIT 1`,
    args: [userId],
  });
  return (res.rows || []).length > 0;
}

export async function getAgentRatingState(userId: string): Promise<{ likes: number; dislikes: number; effectiveDislikes: number; stars: number }> {
  const res = await (db as any).$client.execute({
    sql: `
      SELECT
        SUM(CASE WHEN score = 1 THEN 1 ELSE 0 END) as likes,
        SUM(CASE WHEN score = -1 THEN 1 ELSE 0 END) as dislikes
      FROM agent_ratings
      WHERE to_agent_id = ?
    `,
    args: [userId],
  });

  const likes = Number((res.rows?.[0] as any)?.likes || 0);
  const dislikes = Number((res.rows?.[0] as any)?.dislikes || 0);

  // Policy: every 2 likes mitigates 2 dislikes (pair-based buffer)
  const mitigatedDislikes = Math.min(dislikes, Math.floor(likes / 2) * 2);
  const effectiveDislikes = Math.max(0, dislikes - mitigatedDislikes);

  const stars = Math.max(1, 5 - Math.floor(effectiveDislikes / 2));
  return { likes, dislikes, effectiveDislikes, stars };
}

export async function getAgentStars(userId: string): Promise<number> {
  const state = await getAgentRatingState(userId);
  return state.stars;
}

export async function banAgentAndBlacklistIps(userId: string, reason: string) {
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
