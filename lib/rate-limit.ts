import { db } from './db';

export interface RateLimitConfig {
  interval: number; // milliseconds
  maxRequests: number;
  failClosed?: boolean;
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
    const result = await (db as any).$client.execute({
      sql: `INSERT INTO rate_limits (key, count, reset_at)
            VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET
              count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
              reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
            RETURNING count, reset_at`,
      args: [identifier.slice(0, 500), resetAt, now, now, resetAt],
    });
    const row = result?.rows?.[0];
    const count = Number(row?.count ?? 1);
    const reset = Number(row?.reset_at ?? resetAt);
    const success = count <= config.maxRequests;
    return {
      success,
      limit: config.maxRequests,
      remaining: success ? Math.max(0, config.maxRequests - count) : 0,
      reset,
    };
  } catch {
    return {
      success: !config.failClosed,
      limit: config.maxRequests,
      remaining: config.failClosed ? 0 : config.maxRequests - 1,
      reset: resetAt,
    };
  }
}

export function getRateLimitHeaders(result: Awaited<ReturnType<typeof rateLimit>>) {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': new Date(result.reset).toISOString(),
  };
}
