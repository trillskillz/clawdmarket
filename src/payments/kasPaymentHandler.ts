export type KasPaymentStatus = 'awaiting_kas' | 'confirming' | 'converting' | 'settled' | 'expired' | 'manual_review';

export type KasPaymentRecord = {
  payment_id: string;
  service_id: string;
  buyer_address: string;
  kas_deposit_address: string;
  amount_kas_expected: string;
  amount_kas_received: string;
  item_price: number;
  platform_fee: number;
  total_cost: number;
  seller_amount: number;
  dev_amount: number;
  dev_wallet?: string | null;
  conversion_id?: string;
  converted_amount?: string;
  settlement_tx_hash?: string;
  seller_tx_hash?: string;
  fee_tx_hash?: string;
  status: KasPaymentStatus;
  payout_status: 'pending' | 'fee_sent' | 'seller_paid' | 'complete';
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type KasDeps = {
  createDepositAddress: (paymentId: string) => Promise<string>;
  triggerConversion: (args: { amountKas: string; toToken: 'ETH' | 'USDC' }) => Promise<{ conversionId: string }>;
  settleOnBase: (args: { conversionId: string }) => Promise<{ txHash: string; convertedAmount: string }>;
  now?: () => Date;
};

export class KasPaymentHandler {
  private readonly store = new Map<string, KasPaymentRecord>();
  private readonly deps: KasDeps;

  constructor(deps: KasDeps) {
    this.deps = deps;
  }

  private now() {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async createPayment(input: { service_id: string; buyer_agent_address: string; amount_kas: string; item_price: number; platform_fee: number; total_cost: number; dev_wallet?: string | null }) {
    const payment_id = `pay_${Math.random().toString(36).slice(2, 10)}`;
    const kas_deposit_address = await this.deps.createDepositAddress(payment_id);
    const created = this.now();
    const expires = new Date(created.getTime() + 30 * 60 * 1000);

    const record: KasPaymentRecord = {
      payment_id,
      service_id: input.service_id,
      buyer_address: input.buyer_agent_address,
      kas_deposit_address,
      amount_kas_expected: input.amount_kas,
      amount_kas_received: '0',
      item_price: input.item_price,
      platform_fee: input.platform_fee,
      total_cost: input.total_cost,
      seller_amount: input.item_price,
      dev_amount: input.platform_fee,
      dev_wallet: input.dev_wallet ?? null,
      status: 'awaiting_kas',
      payout_status: 'pending',
      expires_at: expires.toISOString(),
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
    };

    this.store.set(payment_id, record);
    return record;
  }

  getPayment(payment_id: string) {
    const p = this.store.get(payment_id);
    if (!p) return null;

    if (p.status === 'awaiting_kas' && new Date(p.expires_at).getTime() < this.now().getTime()) {
      p.status = 'expired';
      p.updated_at = this.now().toISOString();
      this.store.set(payment_id, p);
    }

    return p;
  }

  async onKasDetected(input: { payment_id: string; amount_kas_received: string; confirmations: number }) {
    const payment = this.store.get(input.payment_id);
    if (!payment) throw new Error('PAYMENT_NOT_FOUND');
    if (payment.status === 'expired') throw new Error('PAYMENT_EXPIRED');

    payment.amount_kas_received = input.amount_kas_received;
    payment.updated_at = this.now().toISOString();

    if (Number(input.amount_kas_received) < Number(payment.amount_kas_expected)) {
      payment.status = 'manual_review';
      this.store.set(payment.payment_id, payment);
      return payment;
    }

    if (input.confirmations < 1) {
      payment.status = 'confirming';
      this.store.set(payment.payment_id, payment);
      return payment;
    }

    payment.status = 'converting';
    this.store.set(payment.payment_id, payment);

    const expectedDev = Math.round(payment.item_price * 0.03 * 100) / 100;
    if (Math.round(payment.dev_amount * 100) / 100 !== expectedDev) {
      throw new Error('DEV_FEE_MISMATCH');
    }

    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const conv = await this.deps.triggerConversion({ amountKas: payment.amount_kas_received, toToken: 'USDC' });
        payment.conversion_id = conv.conversionId;

        const sellerSettlement = await this.deps.settleOnBase({ conversionId: `${conv.conversionId}_seller` });
        payment.seller_tx_hash = sellerSettlement.txHash;
        payment.payout_status = 'seller_paid';

        const feeSettlement = await this.deps.settleOnBase({ conversionId: `${conv.conversionId}_fee` });
        payment.fee_tx_hash = feeSettlement.txHash;
        payment.payout_status = 'fee_sent';

        payment.converted_amount = feeSettlement.convertedAmount;
        payment.settlement_tx_hash = feeSettlement.txHash;
        payment.status = 'settled';
        payment.payout_status = 'complete';
        payment.updated_at = this.now().toISOString();
        this.store.set(payment.payment_id, payment);
        return payment;
      } catch (e) {
        lastErr = e;
      }
    }

    payment.status = 'manual_review';
    payment.updated_at = this.now().toISOString();
    this.store.set(payment.payment_id, payment);
    if (lastErr) console.error(lastErr);
    return payment;
  }
}
