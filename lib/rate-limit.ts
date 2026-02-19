interface RateLimitStore {
  [key: string]: {
    count: number;
    resetAt: number;
  };
}

const store: RateLimitStore = {};

export interface RateLimitConfig {
  interval: number; // milliseconds
  maxRequests: number;
}

const defaultConfig: RateLimitConfig = {
  interval: 60 * 1000, // 1 minute
  maxRequests: 60, // 60 requests per minute
};

export function rateLimit(
  identifier: string,
  config: RateLimitConfig = defaultConfig
): { success: boolean; limit: number; remaining: number; reset: number } {
  const now = Date.now();
  const record = store[identifier];

  // Clean up expired entries periodically
  if (Math.random() < 0.01) {
    cleanupExpiredEntries(now);
  }

  if (!record || now > record.resetAt) {
    store[identifier] = {
      count: 1,
      resetAt: now + config.interval,
    };
    return {
      success: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      reset: store[identifier].resetAt,
    };
  }

  if (record.count >= config.maxRequests) {
    return {
      success: false,
      limit: config.maxRequests,
      remaining: 0,
      reset: record.resetAt,
    };
  }

  record.count++;
  return {
    success: true,
    limit: config.maxRequests,
    remaining: config.maxRequests - record.count,
    reset: record.resetAt,
  };
}

function cleanupExpiredEntries(now: number) {
  for (const key in store) {
    if (store[key].resetAt < now) {
      delete store[key];
    }
  }
}

export function getRateLimitHeaders(result: ReturnType<typeof rateLimit>) {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': new Date(result.reset).toISOString(),
  };
}
