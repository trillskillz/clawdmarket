export type X402ErrorCode =
  | 'MISSING_PAYMENT_SIGNATURE'
  | 'MALFORMED_PAYMENT_SIGNATURE'
  | 'INVALID_X402_VERSION'
  | 'INVALID_PAYMENT_PAYLOAD'
  | 'INVALID_PAYMENT_REQUIREMENTS'
  | 'VERIFICATION_FAILED'
  | 'SETTLEMENT_FAILED'
  | 'UPSTREAM_ERROR'
  | 'RETRY_EXHAUSTED';

export type X402ErrorResponse = {
  success: false;
  error_code: X402ErrorCode;
  message: string;
  retry_after?: number;
};

export type X402SuccessResponse = {
  success: true;
  verification: {
    isValid: true;
    payer?: string;
  };
  settlement: {
    success: true;
    payer?: string;
    transaction: string;
    network: string;
  };
  metadata: {
    requestId: string;
    attempts: number;
  };
};

export type X402HandlerResponse = X402SuccessResponse | X402ErrorResponse;

export type X402PaymentRequirements = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
};

export type X402PaymentPayload = {
  x402Version: number;
  accepted: X402PaymentRequirements;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
  resource?: {
    url?: string;
    description?: string;
    mimeType?: string;
  };
  extensions?: Record<string, unknown>;
};

export type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
};

export type SettleResponse = {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
};

export type X402LifecycleEvent = {
  type:
    | 'x402.payment.requested'
    | 'x402.payment.verified'
    | 'x402.payment.settled'
    | 'x402.payment.failed'
    | 'x402.payment.retry';
  requestId: string;
  at: string;
  details: Record<string, unknown>;
};

export type X402HandlerDependencies = {
  verifyPayment: (args: {
    paymentPayload: X402PaymentPayload;
    paymentRequirements: X402PaymentRequirements;
  }) => Promise<VerifyResponse>;
  settlePayment: (args: {
    paymentPayload: X402PaymentPayload;
    paymentRequirements: X402PaymentRequirements;
  }) => Promise<SettleResponse>;
  emitEvent?: (event: X402LifecycleEvent) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  generateRequestId?: () => string;
};

export type X402HandlerInput = {
  headers: Record<string, string | undefined>;
  method: string;
  path: string;
  isAgentToAgentRequest: boolean;
};

const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1000] as const; // max 3 retries

export function createX402Handler(deps: X402HandlerDependencies) {
  const sleep = deps.sleep ?? (async (ms: number) => await new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());
  const requestIdFactory =
    deps.generateRequestId ??
    (() => `x402_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`);

  async function emit(event: Omit<X402LifecycleEvent, 'at'>) {
    if (!deps.emitEvent) return;
    await deps.emitEvent({ ...event, at: now().toISOString() });
  }

  function normalizeHeaderLookup(headers: Record<string, string | undefined>) {
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v === 'string') map.set(k.toLowerCase(), v);
    }
    return (key: string) => map.get(key.toLowerCase());
  }

  function toError(error_code: X402ErrorCode, message: string, retry_after?: number): X402ErrorResponse {
    const out: X402ErrorResponse = { success: false, error_code, message };
    if (retry_after !== undefined) out.retry_after = retry_after;
    return out;
  }

  function isErrorResponse(value: X402PaymentPayload | X402ErrorResponse): value is X402ErrorResponse {
    return (value as X402ErrorResponse).success === false;
  }

  function parsePaymentHeader(signatureHeader: string): X402PaymentPayload | X402ErrorResponse {
    let decoded = '';
    try {
      decoded = Buffer.from(signatureHeader, 'base64').toString('utf8');
    } catch {
      return toError('MALFORMED_PAYMENT_SIGNATURE', 'PAYMENT-SIGNATURE must be a valid base64-encoded JSON object.');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(decoded);
    } catch {
      return toError('MALFORMED_PAYMENT_SIGNATURE', 'PAYMENT-SIGNATURE must decode to valid JSON.');
    }

    if (!payload || typeof payload !== 'object') {
      return toError('INVALID_PAYMENT_PAYLOAD', 'Decoded payment payload must be an object.');
    }

    const obj = payload as Partial<X402PaymentPayload>;
    if (obj.x402Version !== 2) {
      return toError('INVALID_X402_VERSION', 'Only x402Version=2 is supported.');
    }

    if (!obj.accepted || typeof obj.accepted !== 'object') {
      return toError('INVALID_PAYMENT_REQUIREMENTS', 'Payment payload is missing accepted payment requirements.');
    }

    const requiredAccepted = ['scheme', 'network', 'amount', 'asset', 'payTo'] as const;
    for (const key of requiredAccepted) {
      if (!(obj.accepted as Record<string, unknown>)[key]) {
        return toError('INVALID_PAYMENT_REQUIREMENTS', `Payment requirement field '${key}' is required.`);
      }
    }

    const auth = obj.payload?.authorization;
    if (!obj.payload?.signature || !auth) {
      return toError('INVALID_PAYMENT_PAYLOAD', 'Payment payload is missing signature or authorization fields.');
    }

    const requiredAuth = ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'] as const;
    for (const key of requiredAuth) {
      if (!(auth as Record<string, unknown>)[key]) {
        return toError('INVALID_PAYMENT_PAYLOAD', `Payment authorization field '${key}' is required.`);
      }
    }

    return obj as X402PaymentPayload;
  }

  async function withRetry<T>(
    fn: () => Promise<T>,
    onRetry: (attempt: number, delayMs: number, reason: string) => Promise<void>,
  ): Promise<{ value?: T; attempts: number; error?: unknown }> {
    let attempts = 0;
    let lastError: unknown;

    while (attempts <= DEFAULT_RETRY_DELAYS_MS.length) {
      try {
        attempts += 1;
        const value = await fn();
        return { value, attempts };
      } catch (error) {
        lastError = error;
        const retryIndex = attempts - 1;
        const delay = DEFAULT_RETRY_DELAYS_MS[retryIndex];
        if (delay === undefined) break;
        await onRetry(attempts, delay, error instanceof Error ? error.message : 'unknown_error');
        await sleep(delay);
      }
    }

    return { attempts, error: lastError };
  }

  return {
    async handle(input: X402HandlerInput): Promise<X402HandlerResponse | null> {
      if (!input.isAgentToAgentRequest) return null;

      const requestId = requestIdFactory();
      const getHeader = normalizeHeaderLookup(input.headers);
      const signatureHeader = getHeader('payment-signature');

      if (!signatureHeader) {
        await emit({
          type: 'x402.payment.failed',
          requestId,
          details: { code: 'MISSING_PAYMENT_SIGNATURE', method: input.method, path: input.path },
        });
        return toError('MISSING_PAYMENT_SIGNATURE', 'PAYMENT-SIGNATURE header is required for agent-to-agent transactions.');
      }

      const parsed = parsePaymentHeader(signatureHeader);
      if (isErrorResponse(parsed)) {
        await emit({
          type: 'x402.payment.failed',
          requestId,
          details: { code: parsed.error_code, method: input.method, path: input.path },
        });
        return parsed;
      }

      await emit({
        type: 'x402.payment.requested',
        requestId,
        details: {
          method: input.method,
          path: input.path,
          network: parsed.accepted.network,
          scheme: parsed.accepted.scheme,
          amount: parsed.accepted.amount,
        },
      });

      const verify = await withRetry(
        () => deps.verifyPayment({ paymentPayload: parsed, paymentRequirements: parsed.accepted }),
        async (attempt, delayMs, reason) => {
          await emit({
            type: 'x402.payment.retry',
            requestId,
            details: { phase: 'verify', attempt, retryAfterMs: delayMs, reason },
          });
        },
      );

      if (!verify.value) {
        await emit({
          type: 'x402.payment.failed',
          requestId,
          details: { code: 'RETRY_EXHAUSTED', phase: 'verify', attempts: verify.attempts },
        });
        return toError('RETRY_EXHAUSTED', 'Verification retries exhausted.', 1);
      }

      if (!verify.value.isValid) {
        await emit({
          type: 'x402.payment.failed',
          requestId,
          details: { code: 'VERIFICATION_FAILED', reason: verify.value.invalidReason },
        });
        return toError('VERIFICATION_FAILED', verify.value.invalidReason ?? 'Payment verification failed.');
      }

      await emit({
        type: 'x402.payment.verified',
        requestId,
        details: { payer: verify.value.payer ?? null },
      });

      const settle = await withRetry(
        () => deps.settlePayment({ paymentPayload: parsed, paymentRequirements: parsed.accepted }),
        async (attempt, delayMs, reason) => {
          await emit({
            type: 'x402.payment.retry',
            requestId,
            details: { phase: 'settle', attempt, retryAfterMs: delayMs, reason },
          });
        },
      );

      if (!settle.value) {
        await emit({
          type: 'x402.payment.failed',
          requestId,
          details: { code: 'RETRY_EXHAUSTED', phase: 'settle', attempts: settle.attempts },
        });
        return toError('RETRY_EXHAUSTED', 'Settlement retries exhausted.', 1);
      }

      if (!settle.value.success) {
        await emit({
          type: 'x402.payment.failed',
          requestId,
          details: { code: 'SETTLEMENT_FAILED', reason: settle.value.errorReason },
        });
        return toError('SETTLEMENT_FAILED', settle.value.errorReason ?? 'Payment settlement failed.');
      }

      await emit({
        type: 'x402.payment.settled',
        requestId,
        details: {
          payer: settle.value.payer ?? verify.value.payer ?? null,
          transaction: settle.value.transaction,
          network: settle.value.network,
        },
      });

      return {
        success: true,
        verification: {
          isValid: true,
          payer: verify.value.payer,
        },
        settlement: {
          success: true,
          payer: settle.value.payer,
          transaction: settle.value.transaction,
          network: settle.value.network,
        },
        metadata: {
          requestId,
          attempts: verify.attempts + settle.attempts,
        },
      };
    },
  };
}
