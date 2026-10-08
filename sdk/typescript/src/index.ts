import { SDK_CONTRACT } from './contract.js'
export { SDK_CONTRACT } from './contract.js'

export type A2ATaskState = 'TASK_STATE_SUBMITTED' | 'TASK_STATE_WORKING' | 'TASK_STATE_COMPLETED' | 'TASK_STATE_FAILED' | 'TASK_STATE_CANCELED' | 'TASK_STATE_INPUT_REQUIRED'
export type A2ARouteAction = { action: 'route_work'; request: Omit<RouteRequest, 'client_reference'> } | { action: 'route_work'; route_id: string; mandate_id: string } | { action: 'cancel_route'; route_id: string }
export type A2AMessage = { role: 'ROLE_USER'; messageId: string; taskId?: string; contextId?: string; parts: Array<{ text: string } | { data: A2ARouteAction | Record<string, unknown>; mediaType?: 'application/json' }>; metadata?: Record<string, unknown> }
export type A2ATask = { id: string; contextId: string; status: { state: A2ATaskState; timestamp: string }; artifacts?: Array<{ artifactId: string; name: string; parts: Array<{ data: Record<string, unknown>; mediaType: string }> }>; history?: A2AMessage[] }
export type A2ATaskListOptions = { pageSize?: number; pageToken?: string; contextId?: string; status?: A2ATaskState; statusTimestampAfter?: string; historyLength?: number; includeArtifacts?: boolean }

export type InstantSessionRequest = { client_reference: string; budget_minor: number; expected_unit_price_minor: number; expires_in_seconds: number; acceptance: 'schema_v1'; payment_rail: 'credit' }
export type InstantReceipt = { version: 1; id: string; call_id: string; session_id: string; service_id: string; buyer_id: string; seller_id: string; units: 1; amount_minor: number; currency: 'USD'; payment_rail: 'credit'; metering: 'one_successful_call'; verification: 'schema_v1'; input_sha256: string; output_sha256: string; settled_at: string }
export type InstantSession = { id: string; service_id: string; buyer_id: string; budget_minor: number; balance_minor: number; held_minor: number; spent_minor: number; refunded_minor: number; available_budget_minor: number; status: 'open' | 'closing' | 'closed'; expires_at: string; contract: Record<string, unknown> }
export type InstantCall = { id: string; session_id: string; state: 'pending' | 'claimed' | 'completed' | 'failed'; input: Record<string, unknown>; output: Record<string, unknown> | null; receipt: InstantReceipt | null; deadline_at: string; failure_code: string | null }

export type ProviderRequirements = { approved_providers?: string[]; minimum_accepted_completions?: number; minimum_distinct_buyers?: number }

export type Money = { amount: string; currency: 'USD' }
type RoutePaymentBase = { chain_id: number; token_address: string; payer_address: string; treasury_address: string; minimum_token_reserve_units: string }
export type RouteMandatePayment = RoutePaymentBase & (
  { rail: 'evm'; minimum_native_reserve_wei: string; max_gas_cost_wei: string }
  | { rail: 'mpp'; fee_token_address: string; minimum_fee_token_reserve_units: string; max_fee_token_cost_units: string }
)
export type LegacyMppMandatePayment = RoutePaymentBase & { rail: 'mpp'; minimum_native_reserve_wei: string; max_gas_cost_wei: string }
export type RouteMandateInput = { version: 1; client_reference: string; max_aggregate: string; max_per_execution: string; max_retry_budget: string; max_attempts: number;
  approved_providers: string[]; max_latency_seconds: number; private_data: 'selected_provider_only'; expires_at: string;
  payment: RouteMandatePayment }
export type RouteMandate = { id: string; route_id: string; buyer_id: string; client_reference: string; route_hash: string; terms_hash: string;
  terms: Omit<RouteMandateInput, 'client_reference' | 'payment'> & { payment: RouteMandatePayment | LegacyMppMandatePayment; token_decimals: number; token_usd_price: number; fee_token_decimals?: number };
  state: 'active' | 'revoked'; reserved_amount: string; expires_at: string; created_at: string; revoked_at: string | null; automatic_funded_retry_enabled: boolean }
export type RouteFundingStep = { id: string; mandate_id: string; route_id: string; order_id: string; trade_id: string; amount_minor: number; terms_hash: string;
  state: 'reserved' | 'funded' | 'rejected'; retry_operation_id?: string; previous_trade_id?: string; attempt_id?: string; created_at: string; updated_at: string }
export type BuyerEvmPaymentClaimInput = { intent_id: string; mandate_id: string; serialized_transaction: string; payer_signature: string; buyer_operation_id?: string }
export type BuyerEvmPaymentClaim = { intent_id: string; mandate_id: string; chain_id: number; payer_address: string; nonce: number; tx_hash: string;
  terms_hash: string; maximum_execution_gas_cost_wei: string; state: 'claimed' | 'confirmed'; created_at: string }
export type BuyerEvmPaymentClaimResult = { claim: BuyerEvmPaymentClaim; send_allowed: boolean; idempotent: boolean;
  state: 'submit_exact_transaction' | 'recover_existing_payment' }
export type BuyerEvmIntent = { id: string; trade_id: string; buyer_id: string; origin: string; buyer_operation_id: string | null;
  payer_address: string; chain_id: number; token_address: string; treasury_address: string; token_amount: string; token_decimals: number;
  token_symbol: string; token_usd_price: number; amount_usd: number; expires_at: string; created_at: string; tx_hash: string | null; payer_signature: string | null }
export type BuyerEvmFundingProof = { intent_id: string; chain_id: number; token_address: string; payer_address: string; tx_hash: string; payer_signature?: string }
export type BuyerMppIntent = { id: string; trade_id: string; buyer_id: string; buyer_operation_id: string; mandate_id: string; origin: string;
  terms_hash: string; chain_id: number; payer_address: string; token_address: string; treasury_address: string; token_amount: string;
  token_decimals: number; amount_usd: number; challenge: Record<string, unknown>; expires_at: string; created_at: string }
export type BuyerMppPaymentClaimInput = { intent_id: string; mandate_id: string; buyer_operation_id: string; serialized_transaction: string }
export type BuyerMppPaymentClaim = { intent_id: string; mandate_id: string; chain_id: number; payer_address: string; nonce: number; tx_hash: string;
  terms_hash: string; fee_token_address: string; maximum_fee_token_cost_units: string; valid_before: number;
  state: 'claimed' | 'confirmed'; first_submission_at: string | null; created_at: string }
export type BuyerMppPaymentClaimResult = { claim: BuyerMppPaymentClaim; send_allowed: boolean; idempotent: boolean;
  state: 'submit_exact_credential' | 'recover_existing_payment' }

export type VerificationMethod = 'buyer_review' | 'schema' | 'source_urls' | 'assertions' | 'source_evidence' | 'isolated_checks'
export type IsolatedCheckPolicy = { version: 1; adapter: 'javascript_tests_v1' | 'javascript_static_v1'; verifier_agent_id: string; suite_sha256: string; max_runtime_seconds: number }
export type IsolatedTestSuite = { version: 1; cases: Array<{ id: string; args: unknown[]; expected: unknown }> }
export type IsolatedReport = {
  version: 1; adapter: IsolatedCheckPolicy['adapter']; artifact_sha256: string; suite_sha256: string; status: 'passed' | 'failed'
  total_checks: number; passed_checks: number; failed_checks: number; elapsed_ms: number
  failure: 'checks_failed' | 'timeout' | 'sandbox_failed' | 'resource_limit' | null
  isolation: { kind: 'bwrap-systemd-v1'; network_enabled: false; host_home_mounted: false; memory_limit_bytes: 134217728; task_limit: 32 }
}
export type VerificationJob = {
  id: string; trade_id: string; verifier_agent_id: string; artifact_id: string; artifact_sha256: string; request_hash: string
  policy: IsolatedCheckPolicy; state: 'pending' | 'passed' | 'failed' | 'cancelled' | 'expired'
  created_at: string; expires_at: string; completed_at: string | null; report: IsolatedReport | null; report_hash: string | null
  provenance: { kind: 'buyer_approved_authenticated_verifier'; isolation_observed_by_app: false; semantic_verified: false }
}
export type AssertionRule = { id: string; field: string } & (
  | { op: 'equals'; value: string | number | boolean | null }
  | { op: 'one_of'; values: Array<string | number | boolean | null> }
  | { op: 'number_range' | 'length_range'; min?: number; max?: number }
)
export type VerificationPolicy = {
  required?: true; methods?: VerificationMethod[]; minimum_sources?: number
  assertions?: { version: 1; rules: AssertionRule[] }
  source_evidence?: { version: 1; minimum_sources: number; max_age_days: number; require_claim_links?: boolean }
  acceptance?: { version: 1; mode: 'explicit_buyer' }
  isolated_checks?: IsolatedCheckPolicy
}
export type DeclaredSource = { id: string; url: string; published_at: string }
export type SourceLinkedClaim = { id: string; statement: string; source_ids: string[] }

export type RouteRequest = {
  provider_requirements?: ProviderRequirements
  client_reference: string
  objective: string
  required_capabilities: string[]
  max_budget: Money
  input?: Record<string, unknown>
  deadline_seconds?: number
  verification?: VerificationPolicy
  payment_policy?: { allowed_rails?: Array<'mpp' | 'evm' | 'ledger'> }
  retry_policy?: { max_attempts?: number }
}

export type RouteState = typeof SDK_CONTRACT.route_states[number]

export type RouteCandidate = {
  service_id: string
  seller_agent_id: string | null
  pricing: { model: 'fixed'; amount: string; currency: 'USD'; estimated_total: string }
  estimated_latency_seconds: number | null
  payment_rail: 'mpp' | 'evm'
  verification_methods: VerificationMethod[]
  eligibility: { requirements_satisfied: true; request: ProviderRequirements; saved_policy: ProviderRequirements; confidence: 'backed_completion_observed' | 'unmeasured'; buyer_independence: 'not_verified' }
  evidence_level: 'claimed_only' | 'backed_completion_observed'
  capability_evidence: { capability_id: string; accepted_completion_count: number; distinct_buyer_count: number; measured_quality_score: null }[]
  provider_failures: { provider_declines_90d: number; lease_expiries_90d: number; uncorrected_verification_failures_90d: number; buyer_refund_resolutions_90d: number }
  score: number
  score_components: Record<'capability_fit' | 'price' | 'latency' | 'capacity' | 'verification' | 'backed_execution' | 'provider_failure_penalty', number>
  explanation: string[]
}

export type RoutePlan = RouteRequest & {
  id: string
  state: RouteState
  candidates: RouteCandidate[]
  service_order_id: string | null
  created_at: string
  expires_at: string
}

export type RouteAttempt = {
  id: string
  attempt_number: number
  service_id: string
  state: 'checking' | 'ineligible' | 'reserved'
  failure_code: string | null
  failure_category: 'provider' | 'verification' | 'payment' | 'infrastructure' | 'buyer_policy' | null
  economic: { trade_id: string; trade_status: string; payout_status: string; funding_step_id: string | null; mandate_id: string | null; terms_hash: string | null; amount_minor: number; funding_state: string | null; payment_intent_id: string | null; payment_receipt: { id: string; tx_hash: string | null; token_amount: string | null } | null; transfers: Array<{ id: string; kind: string; status: string; tx_hash: string | null; token_amount: string; confirmed_at: string | null }>; capacity_released_at: string | null } | null
  service_order_id: string | null
  created_at: string
  updated_at: string
}

export type PaymentExposure = {
  state: 'checkout_open' | 'payment_in_flight_possible' | 'late_payment_possible' | 'refund_processing' | 'refunded' | 'funded' | 'settled'
  payment_confirmed: boolean
  late_payment_possible: boolean
  automatic_retry_allowed: false
  retry_blocking_reason: string
}

export type ProviderExecution = {
  attempt_id: string | null
  state: 'not_started' | 'missing' | 'queued' | 'accepted' | 'declined' | 'expired' | 'delivered' | 'interrupted' | 'acknowledgment_timed_out'
  acknowledgment_due_at: string | null
  acknowledgment_overdue: boolean
  accepted_at: string | null
  heartbeat_at: string | null
  lease_expires_at: string | null
  completed_at: string | null
  lease_overdue: boolean
  attention_required: boolean
  attention_reason: 'attempt_missing' | 'provider_declined' | 'lease_expired' | 'attempt_interrupted' | 'acknowledgment_timeout' | 'delivery_deadline_overdue' | null
  reconciliation: { state: 'dispute_available'; action: { method: 'POST'; url: string } }
    | { state: 'dispute_open' | 'resolved'; action: null } | null
  automatic_retry_allowed: false
}

export type AcceptanceStatus = { mode: 'legacy_settlement' | 'explicit_buyer'; auto_confirm_enabled: boolean; accepted: boolean; attention_required: boolean; error_code?: string }
export type RouteSnapshot = { route: RoutePlan; attempts: RouteAttempt[]; payment_exposure: PaymentExposure | null; provider_execution: ProviderExecution | null; acceptance: AcceptanceStatus | null }
export type RouteResultArtifact = { id: string; sha256: string; size_bytes: number; media_type: string }
export type PrivateRouteResult = { route_id: string; trade_id: string; delivery: { id: string; content_hash: string };
  content: { summary: string; artifact: Record<string, unknown> | null; delivery_url: string | null }; result_hash: string; artifacts: RouteResultArtifact[] }
export type RouteOrigin = { channel: 'authenticated_agent' | 'account' | 'mpp_wallet' | 'legacy_unknown'; cohort: 'production' | 'canary' | 'demo' | 'reference' | 'nonproduction' | 'legacy_unknown' }
export type RouteMetrics = { contract_version: 2; currency: 'USD'; plans: number; viable_plans: number; executions: number; cancelled: number; failed: number;
  accepted_settled_routes: number; planning_to_execution_rate: number | null; execution_to_accepted_settlement_rate: number | null;
  assisted_routed_gmv: string; autonomously_routed_gmv: string; autonomously_settled_routes: number; autonomy_status: 'evidence_gated';
  funnel: { funded: number; dispatch_queued: number; provider_acknowledged: number; delivered: number; buyer_accepted: number; payout_confirmed: number; backed_receipts: number };
  latency_seconds: { sample_count: number; funding_to_delivery_sample_count: number; mean_plan_to_settlement: number | null; max_plan_to_settlement: number | null; mean_funding_to_delivery: number | null };
  provider_capacity: { active_services: number; total_slots: number; occupied_slots: number; available_slots: number; utilization_rate: number | null };
  verification: { observations_by_method: Record<string, Record<string, number>>; semantic_verified: false; provenance_verified: false; benchmark_verified: false };
  retry: { reserved_attempts: number; completed_attempts: number; disputed_attempts: number };
  economic_outcomes: { attempts: number; disputed_attempts: number; buyer_resolutions: number; confirmed_refunds: number; refunds_awaiting_confirmation: number };
  origins: Array<RouteOrigin & { plans: number; executions: number }>; definitions: Record<string, string>; updated_at: string }
export type BackedRouteReceipt = { version: 1; route_id: string; trade_id: string; order_id: string; objective_hash: string; input_hash: string;
  selected_provider: { service_id: string; protocol: string | null }; authority: { mandate_id: string; terms_hash: string; funding_step_id: string } | null;
  attempts: RouteAttempt[];
  delivery: { id: string; content_hash: string }; result_hash: string; artifacts: RouteResultArtifact[];
  gross_attempt_total: string; pricing: { currency: 'USD'; item_amount: string; fee_amount: string; buyer_total: string; seller_amount: string }; payment_rail: string;
  verification: { checks: Array<{ method: string; version: string; status: string }>; semantic_verified: false; isolation_observed_by_app: false; [key: string]: unknown };
  buyer_decision: { decision: 'accepted'; content_hash: string }; financial: { kind: 'confirmed_external' | 'backed_account_credit' | 'historical_ledger'; [key: string]: unknown };
  automation?: { origin: RouteOrigin; durable_buyer_funding: boolean; authenticated_agent_decision: boolean };
  settlement_status: 'completed'; completed_at: string; capacity_released: true }
export type RouteLifecycle = { route_id: string; order_id: string | null; trade_id: string | null; phase: string; next_action: string;
  funds_state: string; error_code: string | null; delivery: { id: string; content_hash: string } | null; acceptance: AcceptanceStatus | null;
  receipt: { receipt: BackedRouteReceipt; content_hash: string } | null; provider_protocol: string | null }
export type RouteRetryCommand = { version: 1; mandate_id: string; previous_trade_id: string; retry_operation_id: string }
export type RouteRetryInspection = { route_id: string; trade_id: string | null; reconciliation: { reconciled: boolean; blocking_reason: string | null; funds_state: string } | null; retry: { reconciliation_required: true; funds_state: string; blocking_reason: string | null } }
export type RetriedRoute = { route: { id: string }; order: { id: string; service_id: string; trade_id: string }; trade: { id: string; payment_rail: string }; funding_step: RouteFundingStep; idempotent: boolean; funds_state: string }
export type RouteAdvanceCommand = { version: 1; action: 'observe' } | { version: 1; action: 'accept'; content_hash: string }
export type PlannedRoute = { route: RoutePlan; idempotent: boolean; planning?: { examined: number; truncated: boolean; candidate_count: number; funds_moved: false } }
export type ExecutedRoute = Pick<RouteSnapshot, 'route' | 'attempts' | 'payment_exposure'> & {
  order: { id: string; service_id: string; trade_id: string; [key: string]: unknown }
  trade: { id: string; status: string; payment_rail: string; [key: string]: unknown }
  checkout: Record<string, unknown> | null
  idempotent: boolean
  funds_state: 'payment_unknown' | 'see_trade'
}
export type CancelledRoute = { route: RoutePlan; payment_exposure?: PaymentExposure | null; funds_state?: string; idempotent?: boolean }
export type SpendingPolicySnapshot = { buyer_id: string; version: number; policy: Record<string, unknown> | null; usage: Record<string, string | null>; deployment_ceiling: unknown }

export class ClawdMarketApiError extends Error {
  readonly name = 'ClawdMarketApiError'
  constructor(readonly status: number, readonly code: string, message: string,
    readonly retryable: boolean, readonly fundsState: string, readonly details: unknown,
    readonly payload: Record<string, unknown> = {}, readonly retryAfterSeconds: number | null = null) { super(message) }
}

/** A2A ErrorInfo preserves the task handle and financial uncertainty on rejected writes. */
export class ClawdMarketA2AError extends ClawdMarketApiError {
  constructor(status: number, readonly rpcCode: number, reason: string, message: string, fundsState: string, readonly taskId: string | null, details: unknown) {
    super(status, reason, message, status === 429 || status >= 500, fundsState, details)
  }
}

export class ClawdMarketTransportError extends Error {
  readonly name = 'ClawdMarketTransportError'
  readonly retryable = true
  readonly fundsState = 'unknown'
  constructor(message: string, readonly cause: unknown) { super(message) }
}

export class ClawdMarketTimeoutError extends Error {
  readonly name = 'ClawdMarketTimeoutError'
  readonly fundsState = 'unknown'
  constructor(readonly routeId: string, readonly lastState: RouteState | null) {
    super(`Route ${routeId} did not reach a requested state; last state: ${lastState}`)
  }
}

export type PrivateArtifact = {
  id: string; trade_id: string; order_id: string | null; route_id: string | null; delivery_id: string | null
  uploader_id: string; name: string; media_type: string; size_bytes: number; sha256: string
  provenance: { kind: 'provider_declared'; recorded_by: string; verified: false; description?: string; source_uri?: string }
  created_at: string; retention_expires_at: string; retention_hold: boolean; purged_at: string | null; download_path: string
}
export type ArtifactUpload = {
  client_reference: string; name: string; media_type: 'application/json' | 'text/plain' | 'text/markdown' | 'application/pdf' | 'application/octet-stream'
  content_base64: string; sha256: string; provenance?: { description?: string; source_uri?: string }; execution_attempt_id?: string
}
export type TradeDelivery = { summary: string; delivery_url?: string; artifact?: Record<string, unknown>; execution_attempt_id?: string; artifact_ids?: string[]; verification_artifact_id?: string; verification_job_id?: string }

export type ClientOptions = { apiKey: string; baseUrl?: string; fetch?: typeof fetch }
export type RequestOptions = { signal?: AbortSignal }
export type WebhookSubscription = { id: string; url: string; events: string[]; active: number; created_at: string; last_triggered_at: string | null; failure_count: number }
export type WebhookDelivery = { id: string; event_type: string; status: 'queued' | 'retrying' | 'delivered' | 'failed' | 'suppressed'; response_status: number; delivered_at: string | null; attempts: number; success: number; created_at: string; next_attempt_at: string | null; suppressed_at: string | null; last_error: string | null }
export type FundingVerificationResult = { ok: true; trade: { id: string; status: string; payout_status?: string | null }; status?: 'late_payment_refunded' | 'late_payment_refund_processing'; rejection_code?: string; rejection_reason?: string; receipt?: { tx_hash?: string; payment_reference?: string }; transfers?: Array<{ id: string; kind: string; status: string; tx_hash: string | null }> }

/** Authenticate exact received bytes before JSON parsing. Persist body.delivery_id to reject replays. */
export async function verifyWebhookSignature(secret: string, rawBody: string | Uint8Array, signature: string): Promise<boolean> {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (hex) => parseInt(hex, 16))
  return globalThis.crypto.subtle.verify('HMAC', key, bytes, typeof rawBody === 'string' ? new TextEncoder().encode(rawBody) : new Uint8Array(rawBody))
}

function originUrl(value: string) {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new TypeError('baseUrl must be an HTTPS origin or a local HTTP origin')
  }
  return url
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown, fallback: string) { return typeof value === 'string' && value ? value : fallback }

function retryAfter(response: Response): number | null {
  const value = response.headers.get('Retry-After')
  if (!value) return null
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000)
  return Number.isFinite(seconds) ? Math.max(0, seconds) : null
}

function instantId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new TypeError('instant ID must be a UUID')
  return id
}

function tradePath(tradeId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) throw new TypeError('tradeId must be a UUID')
  return `/api/trades/${tradeId}`
}

function routePath(routeId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(routeId)) throw new TypeError('routeId must be a route UUID')
  return `/api/routes/${routeId}`
}

function verificationJobPath(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new TypeError('verification job ID must be a UUID')
  return `/api/verification-jobs/${id}`
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Route execution reserves an unpaid checkout; explicit instant funding spends deposited credit. The client never broadcasts wallet transfers. */
export class ClawdMarketClient {
  private readonly base: URL
  private readonly fetcher: typeof fetch
  private readonly apiKey: string

  constructor(options: ClientOptions) {
    if (!options.apiKey?.trim()) throw new TypeError('apiKey is required')
    this.apiKey = options.apiKey.trim()
    this.base = originUrl(options.baseUrl || 'https://clawdmkt.com')
    this.fetcher = options.fetch || fetch
  }

  private async request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    let response: Response
    try {
      response = await this.fetcher(new URL(path, this.base), {
        method, redirect: 'error', credentials: 'omit', signal: options.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (cause) {
      throw new ClawdMarketTransportError('ClawdMarket request did not complete; inspect the route before retrying a mutation', cause)
    }
    const payload = await response.json().catch(() => null)
    if (path === '/api/a2a' && object(payload).error) {
      const rpcError = object(object(payload).error)
      const info = Array.isArray(rpcError.data) ? object(rpcError.data[0]) : {}
      const metadata = object(info.metadata)
      throw new ClawdMarketA2AError(response.status, Number(rpcError.code), text(info.reason, 'A2A_ERROR'), text(rpcError.message, 'A2A request rejected'), text(metadata.funds_state, 'unknown'), typeof metadata.task_id === 'string' ? metadata.task_id : null, rpcError.data)
    }
    if (!response.ok) {
      const data = object(payload)
      throw new ClawdMarketApiError(response.status, text(data.error_code ?? data.code, 'HTTP_ERROR'),
        text(data.message ?? data.error, `ClawdMarket returned ${response.status}`), data.retryable === true,
        text(data.funds_state ?? data.state, 'unknown'), data.details, data, retryAfter(response))
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ClawdMarketTransportError('ClawdMarket returned an invalid JSON response', null)
    return payload as T
  }

  /** Read-only canonical recovery after webhook delivery loss, duplication or suppression. */
  listWebhooks(options?: RequestOptions) { return this.request<{ webhooks: WebhookSubscription[] }>('GET', SDK_CONTRACT.operations.list_webhooks.path, undefined, options) }
  getWebhookDeliveries(options?: RequestOptions) { return this.request<{ deliveries: WebhookDelivery[]; total: number }>('GET', SDK_CONTRACT.operations.inspect_webhook_deliveries.path, undefined, options) }
  disableWebhook(id: string, options?: RequestOptions) { return this.request<{ ok: true }>('DELETE', SDK_CONTRACT.operations.disable_webhook.path.replace('{id}', instantId(id)), undefined, options) }
  getWorkOrder(tradeId: string, options?: RequestOptions) { return this.request<{ success: true; work_order: Record<string, unknown> }>('GET', `${tradePath(tradeId)}/work-order`, undefined, options) }
  getServiceOrder(orderId: string, options?: RequestOptions) { return this.request<{ order: Record<string, unknown>; trade: Record<string, unknown>; provider_execution: ProviderExecution | null; acceptance: AcceptanceStatus | null; checkout?: Record<string, unknown> | null }>('GET', `/api/service-orders/${instantId(orderId)}`, undefined, options) }

  getAccountBalance(agentId?: string, options?: RequestOptions) { return this.request<{ account_id: string; available: number; escrow: number; credit: { available_minor: number; escrow_minor: number }; instant_credit: { prepaid_minor: number; held_minor: number }; historical_credit: { spendable: false } }>('GET', `/api/wallet${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ''}`, undefined, options) }
  getConnectedWalletBalances(address: string, options?: RequestOptions) { return this.request<{ address: string; balances: Array<{ chain_id: number; symbol: string; status: 'available' | 'unavailable'; amount: string | null; amount_raw: string | null }> }>('GET', `/api/wallet/balances?address=${encodeURIComponent(address)}`, undefined, options) }
  /** Persist client_reference before calling. Only a fresh created intent permits one transfer; this method never sends. */
  createAccountDeposit(input: { amount_minor: number; payer: string; client_reference: string }, options?: RequestOptions) { return this.request<{ deposit: AccountDeposit }>('POST', '/api/wallet/deposits', input, options) }
  getAccountDeposits(id?: string, options?: RequestOptions) { return this.request<{ deposits: AccountDeposit[] }>('GET', `/api/wallet/deposits${id ? `?id=${encodeURIComponent(id)}` : ''}`, undefined, options) }
  /** Verify the original hash with its payer signature. Confirmation may return HTTP 202; never replace the transfer. */
  confirmAccountDeposit(input: { id: string; tx_hash: string; signature: string }, options?: RequestOptions) { return this.request<{ deposit?: AccountDeposit; code?: string; error?: string }>('PUT', '/api/wallet/deposits', input, options) }
  fundOwnedAgent(input: { agent_id: string; amount_minor: number; client_reference: string }, options?: RequestOptions) { return this.request<{ idempotent: boolean; balance: { available_minor: number; escrow_minor: number } }>('POST', '/api/wallet/transfers', input, options) }
  buyWithAccountCredit(listingId: string, clientReference: string, options?: RequestOptions) { return this.request<{ trade: { id: string; status: string; payment_rail: 'credit' } }>('POST', '/api/trades', { listing_id: listingId, amount: 1, payment_rail: 'credit', client_reference: clientReference }, options) }
  orderServiceWithAccountCredit(serviceId: string, input: { client_reference: string; objective: string; input?: Record<string, unknown>; max_total?: string; expected_price?: string }, options?: RequestOptions) { return this.request<{ order: Record<string, unknown>; trade: Record<string, unknown> }>('POST', `/api/services/${encodeURIComponent(serviceId)}/orders`, { ...input, payment_rail: 'credit' }, options) }

  private async a2aRpc<T>(method: string, params: unknown, options?: RequestOptions): Promise<T> {
    const envelope = await this.request<{ result: T }>('POST', '/api/a2a', { jsonrpc: '2.0', id: globalThis.crypto.randomUUID(), method, params }, options)
    if (!('result' in envelope)) throw new ClawdMarketTransportError('A2A result was missing; recover using the saved messageId or task', null)
    return envelope.result
  }
  getA2AExtendedCard(options?: RequestOptions) { return this.a2aRpc<Record<string, unknown>>('GetExtendedAgentCard', {}, options) }
  /** Save messageId before sending. Uses canonical owner authority; never signs or broadcasts. */
  sendA2AMessage(message: A2AMessage, options?: RequestOptions) { return this.a2aRpc<{ task: A2ATask }>('SendMessage', { message }, options) }
  getA2ATask(taskId: string, historyLength = 0, options?: RequestOptions) { return this.a2aRpc<A2ATask>('GetTask', { id: instantId(taskId), historyLength }, options) }
  listA2ATasks(input: A2ATaskListOptions = {}, options?: RequestOptions) { return this.a2aRpc<{ tasks: A2ATask[]; totalSize: number; pageSize: number; nextPageToken: string }>('ListTasks', input, options) }
  /** Funded cancellation is rejected; an unpaid cancellation may still report payment_unknown. */
  cancelA2ATask(taskId: string, options?: RequestOptions) { return this.a2aRpc<A2ATask>('CancelTask', { id: instantId(taskId) }, options) }

  listInstantServices(options?: RequestOptions) { return this.request<{ services: Record<string, unknown>[] }>('GET', '/api/instant/services', undefined, options) }
  /** Spending action: persist the buyer reference and explicitly accept schema_v1 before funding. */
  openInstantSession(serviceId: string, input: InstantSessionRequest, options?: RequestOptions) { return this.request<{ session: InstantSession; idempotent: boolean }>('POST', `/api/instant/services/${instantId(serviceId)}/sessions`, input, options) }
  getInstantSession(sessionId: string, options?: RequestOptions) { return this.request<{ session: InstantSession }>('GET', `/api/instant/sessions/${instantId(sessionId)}`, undefined, options) }
  closeInstantSession(sessionId: string, options?: RequestOptions) { return this.request<{ session: InstantSession }>('POST', `/api/instant/sessions/${instantId(sessionId)}`, { action: 'close' }, options) }
  /** Reserves one unit only. A returned call can be pending, completed or terminally failed on replay. */
  callInstantService(sessionId: string, input: { client_reference: string; input: Record<string, unknown> }, options?: RequestOptions) { return this.request<{ call: InstantCall; idempotent: boolean }>('POST', `/api/instant/sessions/${instantId(sessionId)}/calls`, input, options) }
  getInstantCall(callId: string, options?: RequestOptions) { return this.request<{ call: InstantCall }>('GET', `/api/instant/calls/${instantId(callId)}`, undefined, options) }
  listInstantProviderCalls(options?: RequestOptions) { return this.request<{ calls: Array<{ id: string; state: 'pending' | 'claimed'; deadline_at: string }> }>('GET', '/api/instant/calls', undefined, options) }
  /** Save a random worker token before claiming; reuse exactly that token on recovery. */
  claimInstantCall(callId: string, leaseToken: string, options?: RequestOptions) { return this.request<{ call: InstantCall }>('POST', `/api/instant/calls/${instantId(callId)}/claim`, { lease_token: leaseToken }, options) }
  completeInstantCall(callId: string, input: { outcome: 'completed'; lease_token: string; output: Record<string, unknown> } | { outcome: 'failed'; lease_token: string }, options?: RequestOptions) { return this.request<{ call: InstantCall; idempotent: boolean }>('POST', `/api/instant/calls/${instantId(callId)}/result`, input, options) }

  /** Nonbinding persisted plan. Safe to replay with the same client_reference. */
  planRoute(input: RouteRequest, options?: RequestOptions) { return this.request<PlannedRoute>('POST', '/api/routes/plan', input, options) }

  /** Convenience alias for planning; it does not reserve capacity or fund work. */
  route(input: RouteRequest, options?: RequestOptions) { return this.planRoute(input, options) }

  /** Reserves one unpaid service order and returns explicit checkout instructions. */
  executeRoute(routeId: string, options?: RequestOptions) { return this.request<ExecutedRoute>('POST', `${routePath(routeId)}/execute`, undefined, options) }

  /** Owner account credential required; authorization creates no order or payment. */
  createRouteMandate(routeId: string, input: RouteMandateInput, options?: RequestOptions) { return this.request<{ mandate: RouteMandate; idempotent: boolean }>('POST', `${routePath(routeId)}/mandate`, input, options) }
  getRouteMandate(routeId: string, options?: RequestOptions) { return this.request<{ mandate: RouteMandate; funding_step: RouteFundingStep | null; funding_steps: RouteFundingStep[] }>('GET', `${routePath(routeId)}/mandate`, undefined, options) }
  revokeRouteMandate(routeId: string, options?: RequestOptions) { return this.request<{ mandate: RouteMandate; idempotent: boolean }>('DELETE', `${routePath(routeId)}/mandate`, undefined, options) }
  /** Atomically reserves one unpaid checkout and mandate exposure; does not sign or send. */
  executeAuthorizedRoute(routeId: string, mandateId: string, options?: RequestOptions) { return this.request<ExecutedRoute>('POST', `${routePath(routeId)}/execute`, { mandate_id: mandateId }, options) }
  /** Call only after fsync of the exact signed transaction; this never broadcasts. */
  claimBuyerEvmPayment(tradeId: string, input: BuyerEvmPaymentClaimInput, options?: RequestOptions) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) throw new Error('trade ID must be a UUID')
    return this.request<BuyerEvmPaymentClaimResult>('POST', `/api/trades/${tradeId}/fund/evm/claim`, input, options)
  }
  /** Read-only verification of an already sent Tempo payment; never signs, broadcasts or replaces it. */
  verifyBuyerMppFunding(tradeId: string, proof: { tx_hash: string; payer_address: string }, options?: RequestOptions) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) throw new TypeError('trade ID must be a UUID')
    return this.request<FundingVerificationResult>('POST', `/api/trades/${tradeId}/fund/mpp`, proof, options)
  }
  /** Save the operation ID first; replay returns the original challenge, never a new payment. */
  createBuyerMppPaymentIntent(tradeId: string, input: { buyer_operation_id: string }, options?: RequestOptions) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) throw new TypeError('trade ID must be a UUID')
    return this.request<{ intent: BuyerMppIntent; created: boolean; claim_required: true }>('POST', `/api/trades/${tradeId}/fund/mpp/intent`, input, options)
  }
  getBuyerMppPaymentIntent(tradeId: string, options?: RequestOptions) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) throw new TypeError('trade ID must be a UUID')
    return this.request<{ intent: BuyerMppIntent | null; claim: BuyerMppPaymentClaim | null; trade: { id: string; status: string; payout_status: string | null } }>('GET', `/api/trades/${tradeId}/fund/mpp/intent`, undefined, options)
  }
  /** Fsync exact signed bytes and their original credential before claiming; no submission occurs here. */
  claimBuyerMppPayment(tradeId: string, input: BuyerMppPaymentClaimInput, options?: RequestOptions) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) throw new TypeError('trade ID must be a UUID')
    return this.request<BuyerMppPaymentClaimResult>('POST', `/api/trades/${tradeId}/fund/mpp/claim`, input, options)
  }

  /** Persist buyer_operation_id privately first. This never signs or broadcasts. */
  createBuyerEvmPaymentIntent(tradeId: string, input: { buyer_operation_id: string; chain_id: number; token_address: string; payer_address: string }, options?: RequestOptions) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) throw new Error('trade ID must be a UUID')
    return this.request<{ intent: BuyerEvmIntent; created: boolean; claim_required: true }>('POST', `/api/trades/${tradeId}/fund/evm/intent`, input, options)
  }
  getBuyerEvmPaymentIntent(tradeId: string, options?: RequestOptions) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) throw new Error('trade ID must be a UUID')
    return this.request<{ intent: BuyerEvmIntent | null; claim: BuyerEvmPaymentClaim | null; trade: { id: string; status: string; payout_status: string | null } }>('GET', `/api/trades/${tradeId}/fund/evm/intent`, undefined, options)
  }
  verifyBuyerEvmFunding(tradeId: string, proof: BuyerEvmFundingProof, options?: RequestOptions) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) throw new Error('trade ID must be a UUID')
    return this.request<FundingVerificationResult>('POST', `/api/trades/${tradeId}/fund/evm`, proof, options)
  }

  getRouteMetrics(options?: RequestOptions) { return this.request<RouteMetrics>('GET', '/api/routes/metrics', undefined, options) }

  getRoute(routeId: string, options?: RequestOptions) { return this.request<RouteSnapshot>('GET', routePath(routeId), undefined, options) }
  inspectRouteRetry(routeId: string, options?: RequestOptions) { return this.request<RouteRetryInspection>('GET', `${routePath(routeId)}/retry`, undefined, options) }
  retryRoute(routeId: string, input: RouteRetryCommand, options?: RequestOptions) { return this.request<RetriedRoute>('POST', `${routePath(routeId)}/retry`, input, options) }
  inspectRouteLifecycle(routeId: string, options?: RequestOptions) { return this.request<RouteLifecycle>('GET', `${routePath(routeId)}/advance`, undefined, options) }
  /** Observe never creates acceptance; accept binds the explicit decision to the exact current delivery hash. */
  advanceRoute(routeId: string, command: RouteAdvanceCommand, options?: RequestOptions) { return this.request<RouteLifecycle>('POST', `${routePath(routeId)}/advance`, command, options) }
  getRouteResult(routeId: string, options?: RequestOptions) { return this.request<PrivateRouteResult>('GET', `${routePath(routeId)}/result`, undefined, options) }

  cancelRoute(routeId: string, options?: RequestOptions) { return this.request<CancelledRoute>('DELETE', routePath(routeId), undefined, options) }

  getSpendingPolicy(options?: RequestOptions) { return this.request<SpendingPolicySnapshot>('GET', '/api/spending-policy', undefined, options) }

  uploadArtifact(tradeId: string, input: ArtifactUpload, options?: RequestOptions) {
    return this.request<{ artifact: PrivateArtifact; idempotent: boolean }>('POST', `${tradePath(tradeId)}/artifacts`, input, options)
  }
  listArtifacts(tradeId: string, options?: RequestOptions) {
    return this.request<{ artifacts: PrivateArtifact[]; limits: { max_bytes: number; max_trade_bytes: number; max_trade_artifacts: number; retention_days: number; request_bytes: number } }>('GET', `${tradePath(tradeId)}/artifacts`, undefined, options)
  }
  deliverTrade(tradeId: string, input: TradeDelivery, options?: RequestOptions) {
    return this.request<{ delivery: { id: string; content_hash: string }; verification: Record<string, unknown>; idempotent: boolean }>('POST', `${tradePath(tradeId)}/delivery`, input, options)
  }
  createVerificationJob(tradeId: string, input: { client_reference: string; artifact_id: string; test_suite: IsolatedTestSuite }, options?: RequestOptions) {
    return this.request<{ job: VerificationJob; idempotent: boolean }>('POST', `${tradePath(tradeId)}/verification-jobs`, input, options)
  }
  getVerificationJob(id: string, options?: RequestOptions) {
    return this.request<{ job: VerificationJob; test_suite?: IsolatedTestSuite; artifact_path?: string; report_path?: string }>('GET', verificationJobPath(id), undefined, options)
  }
  submitVerificationReport(id: string, report: IsolatedReport, options?: RequestOptions) {
    return this.request<{ job: VerificationJob; idempotent: boolean }>('POST', verificationJobPath(id), report, options)
  }
  cancelVerificationJob(id: string, options?: RequestOptions) {
    return this.request<{ job: VerificationJob; idempotent: boolean }>('DELETE', verificationJobPath(id), undefined, options)
  }
  /** Returns bytes only after checking the authenticated download against the saved metadata. */
  async downloadArtifact(artifact: PrivateArtifact, options: RequestOptions = {}) {
    instantId(artifact.id)
    let response: Response
    try {
      response = await this.fetcher(new URL(`${tradePath(artifact.trade_id)}/artifacts/${artifact.id}`, this.base), {
        method: 'GET', redirect: 'error', credentials: 'omit', signal: options.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/octet-stream' },
      })
    } catch (cause) { throw new ClawdMarketTransportError('Private artifact download did not complete', cause) }
    if (!response.ok) {
      const data = object(await response.json().catch(() => null))
      throw new ClawdMarketApiError(response.status, text(data.error_code ?? data.code, 'HTTP_ERROR'), text(data.message ?? data.error, 'Artifact download failed'), data.retryable === true, text(data.funds_state ?? data.state, 'unknown'), data.details, data, retryAfter(response))
    }
    if (!Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 1 || artifact.size_bytes > 65_536 || Number(response.headers.get('Content-Length')) !== artifact.size_bytes || !response.body) throw new ClawdMarketTransportError('Artifact size did not match', null)
    const reader = response.body.getReader()
    const bytes = new Uint8Array(artifact.size_bytes)
    let offset = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        if (offset + part.value.byteLength > bytes.length) throw new ClawdMarketTransportError('Artifact size did not match', null)
        bytes.set(part.value, offset); offset += part.value.byteLength
      }
    } catch (cause) {
      if (cause instanceof ClawdMarketTransportError) throw cause
      throw new ClawdMarketTransportError('Private artifact stream did not complete', cause)
    } finally { void reader.cancel().catch(() => {}) }
    const digest = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))).map((value) => value.toString(16).padStart(2, '0')).join('')
    if (offset !== bytes.length || digest !== artifact.sha256 || response.headers.get('X-Artifact-SHA256') !== digest) throw new ClawdMarketTransportError('Artifact integrity check failed', null)
    return bytes
  }

  async waitForRoute(routeId: string, options: RequestOptions & { states?: RouteState[]; pollIntervalMs?: number; timeoutMs?: number } = {}) {
    const states = options.states || ['completed', 'failed', 'cancelled', 'disputed', 'resolved']
    const interval = options.pollIntervalMs ?? 1_000
    const timeout = options.timeoutMs ?? 60_000
    if (!Number.isFinite(interval) || interval < 1 || !Number.isFinite(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new RangeError('Polling interval and timeout must be positive and bounded')
    const deadline = Date.now() + timeout
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    let lastState: RouteState | null = null
    try {
      while (true) {
        const snapshot = await this.getRoute(routeId, { signal })
        lastState = snapshot.route.state
        if (states.includes(lastState)) return snapshot
        if (Date.now() >= deadline) throw new ClawdMarketTimeoutError(routeId, lastState)
        await delay(Math.min(interval, Math.max(1, deadline - Date.now())), signal)
      }
    } catch (error) {
      if (controller.signal.aborted && !options.signal?.aborted) throw new ClawdMarketTimeoutError(routeId, lastState)
      throw error
    } finally { clearTimeout(timer) }
  }
}

export type AccountDeposit = { id: string; user_id: string; client_reference: string; amount_minor: number; payer: string; treasury: string; token: string; chain_id: number; state: 'pending' | 'confirmed'; created: boolean; token_amount: string; tx_hash: string | null; expires_at: string; proof_message: string | null }
/** Payer signature is specific to this immutable deposit and original hash. */
export function accountDepositMessage(intent: AccountDeposit, hash: string) {
  return ['ClawdMarket USDC account deposit v1', `Intent: ${intent.id}`, `Account: ${intent.user_id}`, `Chain: ${intent.chain_id}`, `Token: ${intent.token}`, `Treasury: ${intent.treasury}`, `Amount cents: ${intent.amount_minor}`, `Transaction: ${hash.toLowerCase()}`].join('\n')
}
