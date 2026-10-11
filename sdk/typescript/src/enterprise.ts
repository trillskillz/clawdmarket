import { SDK_CONTRACT } from './contract.js'
import type { BuyerEvmIntent, BuyerEvmPaymentClaim, BuyerEvmPaymentClaimResult, BuyerEvmFundingProof, BuyerMppIntent, BuyerMppPaymentClaim, BuyerMppPaymentClaimInput, BuyerMppPaymentClaimResult, FundingVerificationResult, ProviderRequirements, RequestOptions, RouteMandatePayment } from './index.js'

type SpendingGrantBase = {
  client_reference: string; name: string; buyer_agent_id: string; team_id: string | null; cost_center: string
  allowed_services: Array<{ service_id: string; provider_share_id: string | null }>
  expires_at: string; max_purchase: string; max_daily: string; max_monthly: string; max_lifetime: string
}
export type SpendingEvmPayment = Extract<RouteMandatePayment, { rail: 'evm' }> & { chain_id: 1 | 11155111; max_lifetime_gas_cost_wei: string }
export type SpendingTempoPayment = Extract<RouteMandatePayment, { rail: 'mpp' }> & { chain_id: 4217; max_lifetime_fee_token_cost_units: string }
type ReviewedMetadata<D extends number = number, P extends number = number> =
  { expected_token_decimals: D; expected_token_usd_price: P } | { expected_token_decimals?: never; expected_token_usd_price?: never }
export type SpendingGrantInput = SpendingGrantBase & (
  { version: 1 } | ({ version: 2; payment: SpendingEvmPayment } & ReviewedMetadata)
  | ({ version: 3; payment: SpendingTempoPayment } & ReviewedMetadata<6, 1>)
)
export type SpendingAccount = SpendingGrantBase & {
  id: string; organization_id: string; state: 'active' | 'revoked'; created_at: string; revoked_at: string | null; credential_prefix: string
} & ({ version: 1; authority: 'approved_direct_service_credit' }
  | { version: 2; authority: 'approved_direct_service_evm'; payment: SpendingEvmPayment; token_decimals: number; token_usd_price: number }
  | { version: 3; authority: 'approved_direct_service_mpp'; payment: SpendingTempoPayment; token_decimals: 6; token_usd_price: 1 })
export type SpendingGrantResult = { account: SpendingAccount; api_key: string | null; idempotent: boolean }
export type SpendingHistory = { spending_accounts: Array<{ account: SpendingAccount; uses: Array<Record<string, unknown>> }> }
export type SpendingOrderInput = { service_id: string; order: {
  client_reference: string; objective: string; payment_rail: 'credit' | 'evm' | 'mpp'; purchasing_approval_id: string
  input?: Record<string, unknown>; provider_share_id?: string; expected_price?: string; max_total?: string
  provider_requirements?: ProviderRequirements
} }
export type SpendingOrderResult = { order: Record<string, unknown>; trade: Record<string, unknown>; use?: Record<string, unknown>; account?: SpendingAccount; idempotent?: boolean }
export type SpendingEvmIntentInput = { buyer_operation_id: string; chain_id: 1 | 11155111; token_address: string; payer_address: string }
export type SpendingEvmClaimInput = { intent_id: string; mandate_id: string; buyer_operation_id: string; serialized_transaction: string; payer_signature: string }
export type SpendingEvmFundingProof = BuyerEvmFundingProof & { chain_id: 1 | 11155111; payer_signature: string }
type OriginalTrade = { id: string; status: string; payout_status: string | null }
type EvmIntentResult = { intent: BuyerEvmIntent; created: boolean; claim_required: true }
type TempoIntentResult = { intent: BuyerMppIntent; created: boolean; claim_required: true }

/** Only exact approved service purchases. Revocation recovery uses a separate original buyer client. */
export interface OrganizationSpendingClient {
  orderService(input: SpendingOrderInput, options?: RequestOptions): Promise<SpendingOrderResult>
  getOrder(orderId: string, options?: RequestOptions): Promise<SpendingOrderResult>
  createEvmPaymentIntent(tradeId: string, input: SpendingEvmIntentInput, options?: RequestOptions): Promise<EvmIntentResult>
  getEvmPaymentIntent(tradeId: string, options?: RequestOptions): Promise<{ intent: BuyerEvmIntent | null; claim: BuyerEvmPaymentClaim | null; trade: OriginalTrade }>
  claimEvmPayment(tradeId: string, input: SpendingEvmClaimInput, options?: RequestOptions): Promise<BuyerEvmPaymentClaimResult>
  verifyEvmFunding(tradeId: string, proof: SpendingEvmFundingProof, options?: RequestOptions): Promise<FundingVerificationResult>
  createTempoPaymentIntent(tradeId: string, input: { buyer_operation_id: string }, options?: RequestOptions): Promise<TempoIntentResult>
  getTempoPaymentIntent(tradeId: string, options?: RequestOptions): Promise<{ intent: BuyerMppIntent | null; claim: BuyerMppPaymentClaim | null; trade: OriginalTrade }>
  claimTempoPayment(tradeId: string, input: BuyerMppPaymentClaimInput, options?: RequestOptions): Promise<BuyerMppPaymentClaimResult>
  verifyTempoFunding(tradeId: string, proof: { tx_hash: string; payer_address: string }, options?: RequestOptions): Promise<FundingVerificationResult>
  /** Explicitly submits only the caller's saved credential; the server may broadcast its claimed original bytes. */
  submitOriginalTempoCredential(tradeId: string, credential: string, options?: RequestOptions): Promise<FundingVerificationResult>
}

export type EnterpriseOperation = 'inspect_spending_accounts' | 'create_spending_account' | 'revoke_spending_account'
  | 'spending_account_service_order' | 'inspect_spending_account_order' | 'spending_evm_intent' | 'recover_spending_evm_intent'
  | 'spending_evm_claim' | 'spending_evm_proof' | 'spending_mpp_intent' | 'recover_spending_mpp_intent' | 'spending_mpp_claim' | 'spending_mpp_proof'
export type EnterpriseRequest = <T>(operation: EnterpriseOperation, params: { id: string; tradeId?: string }, body?: unknown, options?: RequestOptions, query?: Record<string, string>, paymentCredential?: string) => Promise<T>

export function enterpriseId(value: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new TypeError('enterprise ID must be a UUID')
  return value
}
export function originalGrantReference(value: string): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length < 8 || value.length > 200) throw new TypeError('original client_reference must be 8 to 200 characters without surrounding whitespace')
  return value
}
export function originalTempoCredential(value: string): string {
  if (typeof value !== 'string' || !/^Payment [\x21-\x7e]+$/.test(value) || value.length > 16_384) throw new TypeError('original Tempo credential must be a bounded single-line Payment header')
  return value
}
export function enterprisePath(operation: EnterpriseOperation, params: { id: string; tradeId?: string }, query?: Record<string, string>): string {
  const path = SDK_CONTRACT.operations[operation].path.replace(/\{([^}]+)\}/g, (_, name: 'id' | 'tradeId') => enterpriseId(params[name] ?? ''))
  const search = query ? new URLSearchParams(query).toString() : ''
  return path + (search ? `?${search}` : '')
}
export function scopedSpendingClient(apiKey: string, organizationId: string, call: EnterpriseRequest): OrganizationSpendingClient {
  if (!/^cmos_[a-f0-9]{64}$/.test(apiKey)) throw new TypeError('organization spending requires the distinct cmos_ credential')
  const id = enterpriseId(organizationId), params = (tradeId: string) => ({ id, tradeId: enterpriseId(tradeId) })
  return Object.freeze({
    orderService: (input, options) => call('spending_account_service_order', { id }, input, options),
    getOrder: (orderId, options) => call('inspect_spending_account_order', { id }, undefined, options, { order_id: enterpriseId(orderId) }),
    createEvmPaymentIntent: (tradeId, input, options) => call('spending_evm_intent', params(tradeId), input, options),
    getEvmPaymentIntent: (tradeId, options) => call('recover_spending_evm_intent', params(tradeId), undefined, options),
    claimEvmPayment: (tradeId, input, options) => call('spending_evm_claim', params(tradeId), input, options),
    verifyEvmFunding: (tradeId, proof, options) => call('spending_evm_proof', params(tradeId), proof, options),
    createTempoPaymentIntent: (tradeId, input, options) => call('spending_mpp_intent', params(tradeId), input, options),
    getTempoPaymentIntent: (tradeId, options) => call('recover_spending_mpp_intent', params(tradeId), undefined, options),
    claimTempoPayment: (tradeId, input, options) => call('spending_mpp_claim', params(tradeId), input, options),
    verifyTempoFunding: (tradeId, proof, options) => call('spending_mpp_proof', params(tradeId), proof, options),
    submitOriginalTempoCredential: (tradeId, credential, options) => call('spending_mpp_proof', params(tradeId), undefined, options, undefined, originalTempoCredential(credential)),
  } satisfies OrganizationSpendingClient)
}
