export type PaymentToken = 'bnkr' | 'clawdcoin';
export type FailureState = 'refunded' | 'escrow_held' | 'no_funds_moved';

export type PaymentFailureContext = {
  buyer_id: string;
  seller_id?: string;
  amount?: number;
  token: PaymentToken;
  route: string;
  trade_id?: string;
  listing_id?: string;
  error_code: string;
  message: string;
  state: FailureState;
};

export function paymentError(error_code: string, message: string, extra?: Record<string, unknown>) {
  return {
    success: false,
    error_code,
    message,
    ...(extra ?? {}),
  };
}

export function resolveFailureState(args: { fundsMoved: boolean; disputed?: boolean; refunded?: boolean }): FailureState {
  if (args.refunded) return 'refunded';
  if (args.fundsMoved || args.disputed) return 'escrow_held';
  return 'no_funds_moved';
}

export async function logPaymentFailure(ctx: PaymentFailureContext): Promise<void> {
  try {
    const [{ db }, { analytics_events }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/schema'),
    ]);

    await db.insert(analytics_events).values({
      user_id: ctx.buyer_id,
      event_type: 'payment_failure',
      metadata: JSON.stringify({
        ...ctx,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('payment failure log write failed', err);
  }
}
