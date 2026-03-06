export type RateLimitPolicy = 'listing_creation' | 'transaction_initiation' | 'search_query';

export type RateLimitContext = {
  policy: RateLimitPolicy;
  agentId: string;
  method: string;
  path: string;
};

export type RateLimitExceededBody = {
  success: false;
  error_code: 'RATE_LIMIT_EXCEEDED';
  message: string;
  retry_after: number;
};

export type RateLimitDecision =
  | { allowed: true; headers: Record<string, string> }
  | {
      allowed: false;
      status: 429;
      headers: Record<string, string>;
      body: RateLimitExceededBody;
    };

export type SharedRateLimitStore = {
  increment: (key: string, windowMs: number, nowMs: number) => Promise<{ count: number; resetAtMs: number }>;
};

export type RateLimiterConfig = {
  store: SharedRateLimitStore;
  allowlistAgentIds?: string[];
  now?: () => number;
};

const POLICY_CONFIG: Record<RateLimitPolicy, { limit: number; windowMs: number; label: string }> = {
  listing_creation: {
    limit: 10,
    windowMs: 60 * 60 * 1000,
    label: 'Listing creation rate limit exceeded (10/hour).',
  },
  transaction_initiation: {
    limit: 60,
    windowMs: 60 * 1000,
    label: 'Transaction initiation rate limit exceeded (60/min).',
  },
  search_query: {
    limit: 120,
    windowMs: 60 * 1000,
    label: 'Search/query rate limit exceeded (120/min).',
  },
};

export class InMemorySharedRateLimitStore implements SharedRateLimitStore {
  private readonly map = new Map<string, { count: number; resetAtMs: number }>();

  async increment(key: string, windowMs: number, nowMs: number) {
    const existing = this.map.get(key);
    if (!existing || nowMs > existing.resetAtMs) {
      const next = { count: 1, resetAtMs: nowMs + windowMs };
      this.map.set(key, next);
      return next;
    }

    existing.count += 1;
    this.map.set(key, existing);
    return existing;
  }
}

export function createRateLimiter(config: RateLimiterConfig) {
  const now = config.now ?? (() => Date.now());
  const allowlist = new Set((config.allowlistAgentIds ?? []).map((x) => x.toLowerCase()));

  return {
    async enforce(ctx: RateLimitContext): Promise<RateLimitDecision> {
      if (allowlist.has(ctx.agentId.toLowerCase())) {
        return {
          allowed: true,
          headers: {
            'X-RateLimit-Policy': ctx.policy,
            'X-RateLimit-Bypass': 'allowlist',
          },
        };
      }

      const cfg = POLICY_CONFIG[ctx.policy];
      const currentMs = now();
      const key = `ratelimit:${ctx.policy}:${ctx.agentId}`;
      const slot = await config.store.increment(key, cfg.windowMs, currentMs);

      const remaining = Math.max(0, cfg.limit - slot.count);
      const retryAfter = Math.max(1, Math.ceil((slot.resetAtMs - currentMs) / 1000));

      const headers = {
        'X-RateLimit-Limit': String(cfg.limit),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': new Date(slot.resetAtMs).toISOString(),
        'X-RateLimit-Policy': ctx.policy,
      };

      if (slot.count <= cfg.limit) {
        return { allowed: true, headers };
      }

      return {
        allowed: false,
        status: 429,
        headers: {
          ...headers,
          'Retry-After': String(retryAfter),
        },
        body: {
          success: false,
          error_code: 'RATE_LIMIT_EXCEEDED',
          message: cfg.label,
          retry_after: retryAfter,
        },
      };
    },
  };
}
