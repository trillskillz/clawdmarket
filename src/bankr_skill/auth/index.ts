import jwt from 'jsonwebtoken';

export type AuthMethod = 'api_key' | 'oauth2' | 'wallet_signature';

export type AgentIdentity = {
  agent_id: string;
  wallet_address: string;
  user_id: string;
};

export type AuthRequest = {
  headers: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  ip?: string;
};

export type AuthSuccess = {
  success: true;
  auth_method: AuthMethod;
  agent: AgentIdentity;
};

export type AuthFailure = {
  success: false;
  status: 401 | 429;
  error_code:
    | 'RATE_LIMITED'
    | 'MISSING_CREDENTIALS'
    | 'INVALID_API_KEY'
    | 'INVALID_TOKEN'
    | 'EXPIRED_TOKEN'
    | 'INVALID_SIGNATURE'
    | 'WALLET_MISMATCH';
  message: string;
  retry_after?: number;
};

export type AuthResult = AuthSuccess | AuthFailure;

export type RateLimitStore = {
  increment: (key: string, windowMs: number, nowMs: number) => { count: number; resetAt: number };
};

class MemoryRateLimitStore implements RateLimitStore {
  private readonly map = new Map<string, { count: number; resetAt: number }>();

  increment(key: string, windowMs: number, nowMs: number) {
    const existing = this.map.get(key);
    if (!existing || nowMs > existing.resetAt) {
      const next = { count: 1, resetAt: nowMs + windowMs };
      this.map.set(key, next);
      return next;
    }

    existing.count += 1;
    this.map.set(key, existing);
    return existing;
  }
}

export type BankrAuthBridgeDeps = {
  findAgentByApiKey: (apiKey: string) => Promise<AgentIdentity | null>;
  findAgentByUserId: (userId: string) => Promise<AgentIdentity | null>;
  findAgentByWallet: (walletAddress: string) => Promise<AgentIdentity | null>;
  createAgentForWallet: (walletAddress: string) => Promise<AgentIdentity>;
  verifyWalletSignature: (args: {
    walletAddress: string;
    signature: string;
    payload: string;
  }) => Promise<boolean>;
  rateLimitStore?: RateLimitStore;
  now?: () => number;
};

export type BankrAuthBridgeConfig = {
  minWindowLimit?: number; // default 60
  hourWindowLimit?: number; // default 1000
};

function getHeader(headers: Record<string, string | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function parseBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}

function unauthorized(error_code: AuthFailure['error_code'], message: string): AuthFailure {
  return { success: false, status: 401, error_code, message };
}

function rateLimited(retry_after: number): AuthFailure {
  return {
    success: false,
    status: 429,
    error_code: 'RATE_LIMITED',
    message: 'Rate limit exceeded for this agent.',
    retry_after,
  };
}

type JwtPayload = { userId: string; email?: string; role?: string };

function verifyJwtToken(token: string): JwtPayload | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}

export function createBankrAuthBridge(deps: BankrAuthBridgeDeps, cfg: BankrAuthBridgeConfig = {}) {
  const now = deps.now ?? (() => Date.now());
  const store = deps.rateLimitStore ?? new MemoryRateLimitStore();

  const minuteLimit = cfg.minWindowLimit ?? 60;
  const hourLimit = cfg.hourWindowLimit ?? 1000;

  function enforceRateLimit(agentId: string): AuthFailure | null {
    const nowMs = now();
    const minute = store.increment(`bankr-auth:${agentId}:m`, 60_000, nowMs);
    if (minute.count > minuteLimit) {
      return rateLimited(Math.max(1, Math.ceil((minute.resetAt - nowMs) / 1000)));
    }

    const hour = store.increment(`bankr-auth:${agentId}:h`, 3_600_000, nowMs);
    if (hour.count > hourLimit) {
      return rateLimited(Math.max(1, Math.ceil((hour.resetAt - nowMs) / 1000)));
    }

    return null;
  }

  async function ensureAgentByWallet(walletAddress?: string): Promise<AgentIdentity | null> {
    if (!walletAddress) return null;
    const existing = await deps.findAgentByWallet(walletAddress);
    if (existing) return existing;
    return deps.createAgentForWallet(walletAddress);
  }

  return {
    async authenticate(req: AuthRequest): Promise<AuthResult> {
      const authHeader = getHeader(req.headers, 'Authorization');
      const token = parseBearerToken(authHeader);

      const walletAddress = (req.body?.wallet_address as string | undefined) ?? getHeader(req.headers, 'x-agent-wallet');
      const signature = getHeader(req.headers, 'x-agent-signature');
      const signedPayload = getHeader(req.headers, 'x-agent-signed-payload') ?? JSON.stringify(req.body ?? {});

      // 1) Preferred: API key for agent-to-agent usage
      if (token?.startsWith('clawd_')) {
        const agent = await deps.findAgentByApiKey(token);
        if (!agent) return unauthorized('INVALID_API_KEY', 'API key is invalid.');

        const limited = enforceRateLimit(agent.agent_id);
        if (limited) return limited;

        return { success: true, auth_method: 'api_key', agent };
      }

      // 2) OAuth/JWT bearer token
      if (token) {
        const payload = verifyJwtToken(token);
        if (!payload) return unauthorized('INVALID_TOKEN', 'Bearer token is invalid or expired.');

        const agent = await deps.findAgentByUserId(payload.userId);
        if (!agent) {
          const byWallet = await ensureAgentByWallet(walletAddress);
          if (!byWallet) return unauthorized('INVALID_TOKEN', 'No agent account associated with this token.');

          const limited = enforceRateLimit(byWallet.agent_id);
          if (limited) return limited;
          return { success: true, auth_method: 'oauth2', agent: byWallet };
        }

        const limited = enforceRateLimit(agent.agent_id);
        if (limited) return limited;

        return { success: true, auth_method: 'oauth2', agent };
      }

      // 3) Wallet signature fallback for stateless auth
      if (walletAddress && signature) {
        const isValid = await deps.verifyWalletSignature({
          walletAddress,
          signature,
          payload: signedPayload,
        });

        if (!isValid) {
          return unauthorized('INVALID_SIGNATURE', 'Wallet signature verification failed.');
        }

        const agent = await ensureAgentByWallet(walletAddress);
        if (!agent) return unauthorized('WALLET_MISMATCH', 'Unable to associate wallet with an agent account.');

        if (agent.wallet_address.toLowerCase() !== walletAddress.toLowerCase()) {
          return unauthorized('WALLET_MISMATCH', 'Wallet does not match associated agent account.');
        }

        const limited = enforceRateLimit(agent.agent_id);
        if (limited) return limited;

        return { success: true, auth_method: 'wallet_signature', agent };
      }

      return unauthorized('MISSING_CREDENTIALS', 'Provide API key, bearer token, or signed wallet headers.');
    },
  };
}
