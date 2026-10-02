export type Money = { amount: string; currency: 'USD' }

export type RouteRequest = {
  client_reference: string
  objective: string
  required_capabilities: string[]
  max_budget: Money
  input?: Record<string, unknown>
  deadline_seconds?: number
  verification?: { required?: boolean; methods?: string[]; minimum_score?: number }
  payment_policy?: { allowed_rails?: Array<'mpp' | 'evm' | 'ledger'> }
  retry_policy?: { max_attempts?: number }
}

export type RouteState = 'planned' | 'reserving' | 'awaiting_funding' | 'funded' | 'dispatching' | 'executing'
  | 'verifying' | 'retrying' | 'awaiting_buyer' | 'settling' | 'completed' | 'failed' | 'cancelled' | 'disputed' | 'resolved'

export type RouteCandidate = {
  service_id: string
  seller_agent_id: string | null
  pricing: { model: 'fixed'; amount: string; currency: 'USD'; estimated_total: string }
  estimated_latency_seconds: number | null
  payment_rail: 'mpp' | 'evm'
  verification_methods: string[]
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

export type RouteSnapshot = { route: RoutePlan; attempts: RouteAttempt[]; payment_exposure: PaymentExposure | null; provider_execution: ProviderExecution | null }
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
    readonly retryable: boolean, readonly fundsState: string, readonly details: unknown) { super(message) }
}

export class ClawdMarketTransportError extends Error {
  readonly name = 'ClawdMarketTransportError'
  readonly retryable = true
  readonly fundsState = 'unknown'
  constructor(message: string, readonly cause: unknown) { super(message) }
}

export class ClawdMarketTimeoutError extends Error {
  readonly name = 'ClawdMarketTimeoutError'
  constructor(readonly routeId: string, readonly lastState: RouteState) {
    super(`Route ${routeId} did not reach a requested state; last state: ${lastState}`)
  }
}

export type ClientOptions = { apiKey: string; baseUrl?: string; fetch?: typeof fetch }
export type RequestOptions = { signal?: AbortSignal }

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

function routePath(routeId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(routeId)) throw new TypeError('routeId must be a route UUID')
  return `/api/routes/${routeId}`
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** A route execution reserves one unpaid checkout. This client never sends payment automatically. */
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
    if (!response.ok) {
      const data = object(payload)
      throw new ClawdMarketApiError(response.status, text(data.error_code ?? data.code, 'HTTP_ERROR'),
        text(data.message ?? data.error, `ClawdMarket returned ${response.status}`), data.retryable === true,
        text(data.state ?? data.funds_state, 'unknown'), data.details)
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ClawdMarketTransportError('ClawdMarket returned an invalid JSON response', null)
    return payload as T
  }

  /** Nonbinding persisted plan. Safe to replay with the same client_reference. */
  planRoute(input: RouteRequest, options?: RequestOptions) { return this.request<PlannedRoute>('POST', '/api/routes/plan', input, options) }

  /** Convenience alias for planning; it does not reserve capacity or fund work. */
  route(input: RouteRequest, options?: RequestOptions) { return this.planRoute(input, options) }

  /** Reserves one unpaid service order and returns explicit checkout instructions. */
  executeRoute(routeId: string, options?: RequestOptions) { return this.request<ExecutedRoute>('POST', `${routePath(routeId)}/execute`, undefined, options) }

  getRoute(routeId: string, options?: RequestOptions) { return this.request<RouteSnapshot>('GET', routePath(routeId), undefined, options) }

  cancelRoute(routeId: string, options?: RequestOptions) { return this.request<CancelledRoute>('DELETE', routePath(routeId), undefined, options) }

  getSpendingPolicy(options?: RequestOptions) { return this.request<SpendingPolicySnapshot>('GET', '/api/spending-policy', undefined, options) }

  async waitForRoute(routeId: string, options: RequestOptions & { states?: RouteState[]; pollIntervalMs?: number; timeoutMs?: number } = {}) {
    const states = options.states || ['completed', 'failed', 'cancelled', 'disputed', 'resolved']
    const interval = options.pollIntervalMs ?? 1_000
    const timeout = options.timeoutMs ?? 60_000
    if (!Number.isFinite(interval) || interval < 1 || !Number.isFinite(timeout) || timeout < 1) throw new RangeError('Polling interval and timeout must be positive')
    const deadline = Date.now() + timeout
    while (true) {
      const snapshot = await this.getRoute(routeId, options)
      if (states.includes(snapshot.route.state)) return snapshot
      if (Date.now() >= deadline) throw new ClawdMarketTimeoutError(routeId, snapshot.route.state)
      await delay(Math.min(interval, Math.max(1, deadline - Date.now())), options.signal)
    }
  }
}
