import { resolvePaymentMethod, type SettlementResult } from '@/src/payments/settlementService';

export type BankrIntent =
  | 'list_service'
  | 'find_agent'
  | 'pay_with_bnkr'
  | 'check_balance';

export type IntentEnvelope = {
  intent: BankrIntent;
  agent_id: string;
  wallet?: string;
  timestamp?: number;
  params: Record<string, unknown>;
};

export type HandlerResponse = {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  error_code?: string;
};

export type ListingSearchResult = {
  id: string;
  name: string;
  price_kas: number;
  agent_wallet_address: string;
  description?: string;
};

export type BankrSkillDeps = {
  createListing: (input: {
    service_name: string;
    description: string;
    price_kas: number;
    agent_wallet_address: string;
    agent_id: string;
  }) => Promise<{ listing_id: string }>;
  searchListings: (keyword: string, limit: number) => Promise<ListingSearchResult[]>;
  findListingByName: (serviceName: string) => Promise<{ id: string; seller_id: string; price_bnkr: string } | null>;
  settlePayment: (input: {
    transaction_type: 'agent_service_payment';
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
  }) => Promise<SettlementResult>;
  getAgentBalance: (agentWalletAddress: string) => Promise<{ kas_balance: number; pending_escrow: number }>;
  logInvocation: (entry: {
    intent: BankrIntent;
    agent_id: string;
    timestamp: number;
    success: boolean;
    error_code?: string;
  }) => Promise<void> | void;
  now?: () => number;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function toValidationError(message: string, error_code = 'VALIDATION_ERROR'): HandlerResponse {
  return { success: false, message, error_code };
}

export function createBankrSkillHandlers(deps: BankrSkillDeps) {
  const now = deps.now ?? (() => Date.now());

  async function withLogging(intent: BankrIntent, agent_id: string, fn: () => Promise<HandlerResponse>): Promise<HandlerResponse> {
    const ts = now();
    try {
      const result = await fn();
      await deps.logInvocation({
        intent,
        agent_id,
        timestamp: ts,
        success: result.success,
        error_code: result.error_code,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected handler error';
      await deps.logInvocation({
        intent,
        agent_id,
        timestamp: ts,
        success: false,
        error_code: 'INTERNAL_ERROR',
      });
      return { success: false, error_code: 'INTERNAL_ERROR', message };
    }
  }

  return {
    async listService(intent: IntentEnvelope): Promise<HandlerResponse> {
      return withLogging('list_service', intent.agent_id, async () => {
        const service_name = intent.params.service_name;
        const description = intent.params.description;
        const price = intent.params.price_kas;
        const agent_wallet_address = intent.params.agent_wallet_address;

        if (!isNonEmptyString(service_name)) return toValidationError('Missing required parameter: service_name');
        if (!isNonEmptyString(description)) return toValidationError('Missing required parameter: description');
        if (typeof price !== 'number' || Number.isNaN(price) || price <= 0)
          return toValidationError('Missing or invalid required parameter: price_kas');
        if (!isNonEmptyString(agent_wallet_address)) return toValidationError('Missing required parameter: agent_wallet_address');

        const created = await deps.createListing({
          service_name,
          description,
          price_kas: price,
          agent_wallet_address,
          agent_id: intent.agent_id,
        });

        return {
          success: true,
          message: `Service '${service_name}' listed successfully on ClawdMarket.`,
          data: {
            listing_id: created.listing_id,
            service_name,
            price_kas: price,
            agent_wallet_address,
          },
        };
      });
    },

    async findAgent(intent: IntentEnvelope): Promise<HandlerResponse> {
      return withLogging('find_agent', intent.agent_id, async () => {
        const keyword = intent.params.capability_keyword;
        if (!isNonEmptyString(keyword)) return toValidationError('Missing required parameter: capability_keyword');

        const matches = await deps.searchListings(keyword, 5);
        return {
          success: true,
          message: matches.length
            ? `Found ${matches.length} matching agent service(s).`
            : 'No matching agents found for that capability.',
          data: {
            query: keyword,
            matches: matches.map((m) => ({
              name: m.name,
              price_kas: m.price_kas,
              agent_wallet_address: m.agent_wallet_address,
              listing_id: m.id,
            })),
          },
        };
      });
    },

    async payWithBnkr(
      intent: IntentEnvelope,
      context?: {
        x402Headers?: Record<string, string | undefined>;
        method?: string;
        path?: string;
      },
    ): Promise<HandlerResponse> {
      return withLogging('pay_with_bnkr', intent.agent_id, async () => {
        const service = intent.params.service_id_or_name;
        const payer_wallet = intent.params.payer_wallet;
        const max_amount_bnkr = intent.params.max_amount_bnkr;

        if (!isNonEmptyString(service)) return toValidationError('Missing required parameter: service_id_or_name');
        if (!isNonEmptyString(payer_wallet)) return toValidationError('Missing required parameter: payer_wallet');
        if (!isNonEmptyString(max_amount_bnkr)) return toValidationError('Missing required parameter: max_amount_bnkr');

        const listing = await deps.findListingByName(service);
        if (!listing) {
          return { success: false, error_code: 'SERVICE_NOT_FOUND', message: `Service '${service}' was not found.` };
        }

        const settlement = await deps.settlePayment({
          transaction_type: 'agent_service_payment',
          amount: listing.price_bnkr,
          payer_id: intent.agent_id,
          recipient_id: listing.seller_id,
          metadata: {
            service: service,
            payer_wallet,
            max_amount_bnkr,
            requested_payment_method: resolvePaymentMethod('agent_service_payment'),
          },
          x402: {
            headers: context?.x402Headers ?? {},
            method: context?.method ?? 'POST',
            path: context?.path ?? '/api/bankr_skill/intent/pay-with-bnkr',
            isAgentToAgentRequest: true,
          },
        });

        if (!settlement.success) {
          return {
            success: false,
            error_code: settlement.error_code ?? 'PAYMENT_FAILED',
            message: settlement.message ?? 'BNKR payment failed.',
            data: {
              payment_method: settlement.payment_method,
            },
          };
        }

        return {
          success: true,
          message: `BNKR payment settled for service '${service}'.`,
          data: {
            transaction_id: settlement.transaction_id,
            payment_method: settlement.payment_method,
            settlement: settlement.details,
          },
        };
      });
    },

    async checkBalance(intent: IntentEnvelope): Promise<HandlerResponse> {
      return withLogging('check_balance', intent.agent_id, async () => {
        const wallet = intent.params.agent_wallet_address;
        if (!isNonEmptyString(wallet)) return toValidationError('Missing required parameter: agent_wallet_address');

        const balance = await deps.getAgentBalance(wallet);
        return {
          success: true,
          message: 'Retrieved ClawdMarket balance successfully.',
          data: {
            agent_wallet_address: wallet,
            kas_balance: balance.kas_balance,
            pending_escrow: balance.pending_escrow,
          },
        };
      });
    },
  };
}
