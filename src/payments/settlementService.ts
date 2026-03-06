import type { X402HandlerResponse } from '@/src/payments/x402Handler';

export type PaymentMethod = 'bnkr' | 'clawdcoin';

export type TransactionType =
  | 'agent_execution_fee'
  | 'agent_service_payment'
  | 'listing_fee'
  | 'service_payment'
  | 'escrow_deposit'
  | 'escrow_release'
  | 'other';

export type SettlementRequest = {
  transaction_type: TransactionType;
  amount: string;
  payer_id: string;
  recipient_id: string;
  metadata?: Record<string, unknown>;
  x402?: {
    headers: Record<string, string | undefined>;
    method: string;
    path: string;
    isAgentToAgentRequest: boolean;
  };
};

export type SettlementResult = {
  success: boolean;
  payment_method: PaymentMethod;
  transaction_id?: string;
  error_code?: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type TransactionRecord = {
  id: string;
  payment_method: PaymentMethod;
  amount: string;
  transaction_type: TransactionType;
  payer_id: string;
  recipient_id: string;
  metadata?: Record<string, unknown>;
};

export type SettlementDependencies = {
  executeBnkrViaX402: (input: Required<SettlementRequest>['x402']) => Promise<X402HandlerResponse | null>;
  executeClawdcoinSettlement: (input: SettlementRequest) => Promise<SettlementResult>;
  recordTransaction: (record: TransactionRecord) => Promise<void>;
  generateTransactionId?: () => string;
};

const BNKR_TRANSACTION_TYPES = new Set<TransactionType>(['agent_execution_fee', 'agent_service_payment']);

export function resolvePaymentMethod(transactionType: TransactionType): PaymentMethod {
  return BNKR_TRANSACTION_TYPES.has(transactionType) ? 'bnkr' : 'clawdcoin';
}

export function createSettlementService(deps: SettlementDependencies) {
  const txIdFactory =
    deps.generateTransactionId ?? (() => `stl_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`);

  return {
    async settle(request: SettlementRequest): Promise<SettlementResult> {
      const payment_method = resolvePaymentMethod(request.transaction_type);

      if (payment_method === 'bnkr') {
        if (!request.x402) {
          return {
            success: false,
            payment_method,
            error_code: 'X402_CONTEXT_REQUIRED',
            message: 'BNKR settlements require x402 request context.',
          };
        }

        const x402Result = await deps.executeBnkrViaX402(request.x402);

        if (!x402Result || x402Result.success === false) {
          return {
            success: false,
            payment_method,
            error_code: x402Result?.error_code ?? 'X402_HANDLER_FAILED',
            message: x402Result?.message ?? 'BNKR x402 handler failed to produce a settlement result.',
            details: {
              retry_after: x402Result && 'retry_after' in x402Result ? x402Result.retry_after : undefined,
            },
          };
        }

        const transaction_id = txIdFactory();
        await deps.recordTransaction({
          id: transaction_id,
          payment_method,
          amount: request.amount,
          transaction_type: request.transaction_type,
          payer_id: request.payer_id,
          recipient_id: request.recipient_id,
          metadata: {
            ...(request.metadata ?? {}),
            network: x402Result.settlement.network,
            onchain_transaction: x402Result.settlement.transaction,
            payer_wallet: x402Result.settlement.payer ?? x402Result.verification.payer,
            source: 'x402',
          },
        });

        return {
          success: true,
          payment_method,
          transaction_id,
          details: {
            network: x402Result.settlement.network,
            onchain_transaction: x402Result.settlement.transaction,
          },
        };
      }

      const clawdcoinResult = await deps.executeClawdcoinSettlement(request);
      if (!clawdcoinResult.success) {
        return {
          ...clawdcoinResult,
          payment_method,
        };
      }

      const transaction_id = clawdcoinResult.transaction_id ?? txIdFactory();
      await deps.recordTransaction({
        id: transaction_id,
        payment_method,
        amount: request.amount,
        transaction_type: request.transaction_type,
        payer_id: request.payer_id,
        recipient_id: request.recipient_id,
        metadata: {
          ...(request.metadata ?? {}),
          ...(clawdcoinResult.details ?? {}),
          source: 'clawdcoin_ledger',
        },
      });

      return {
        ...clawdcoinResult,
        success: true,
        payment_method,
        transaction_id,
      };
    },
  };
}
