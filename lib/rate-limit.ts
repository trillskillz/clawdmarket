import { db } from './db';
import { rate_limits } from './schema';
import { eq, and, gt, sql } from 'drizzle-orm';

export interface RateLimitConfig {
  interval: number; // milliseconds
  maxRequests: number;
}

const defaultConfig: RateLimitConfig = {
  interval: 60 * 1000,
  maxRequests: 60,
};

export async function rateLimit(
  identifier: string,
  config: RateLimitConfig = defaultConfig
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const now = Date.now();
  const resetAt = now + config.interval;

  try {
    const row = await db
      .select()
      .from(rate_limits)
      .where(eq(rate_limits.key, identifier))
      .limit(1)
      .then(rows => rows[0]);

    if (!row || now > row.reset_at) {
      await db
        .insert(rate_limits)
        .values({ key: identifier, count: 1, reset_at: resetAt })
        .onConflictDoUpdate({
          target: rate_limits.key,
          set: { count: 1, reset_at: resetAt },
        });
      return { success: true, limit: config.maxRequests, remaining: config.maxRequests - 1, reset: resetAt };
    }

    if (row.count >= config.maxRequests) {
      return { success: false, limit: config.maxRequests, remaining: 0, reset: row.reset_at };
    }

    await db
      .update(rate_limits)
      .set({ count: sql`${rate_limits.count} + 1` })
      .where(and(eq(rate_limits.key, identifier), gt(rate_limits.reset_at, now)));

    const newCount = row.count + 1;
    return { success: true, limit: config.maxRequests, remaining: config.maxRequests - newCount, reset: row.reset_at };
  } catch {
    // If DB is unavailable, fail open to avoid blocking all requests
    return { success: true, limit: config.maxRequests, remaining: config.maxRequests - 1, reset: resetAt };
  }
}

export function getRateLimitHeaders(result: Awaited<ReturnType<typeof rateLimit>>) {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': new Date(result.reset).toISOString(),
  };
}
