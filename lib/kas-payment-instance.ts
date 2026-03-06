import { KasPaymentHandler } from '@/src/payments/kasPaymentHandler';

export const kasPaymentHandler = new KasPaymentHandler({
  createDepositAddress: async (id) => `kaspa:${id}`,
  triggerConversion: async () => ({ conversionId: `conv_${Date.now()}` }),
  settleOnBase: async ({ conversionId }) => ({ txHash: `0x${conversionId}`, convertedAmount: '0' }),
});
