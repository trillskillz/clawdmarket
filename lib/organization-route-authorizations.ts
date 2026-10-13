import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { organizations, organization_provider_shares, organization_agent_assignments, agent_owners, agents, users, organization_teams,
  organization_purchasing_roles, organization_route_authorizations as grants, organization_route_uses as uses,
  organization_route_tempo_fees as tempoFees, route_plans, route_payment_mandates, service_definitions, service_orders, trades, route_funding_steps } from './schema'
import { purchasingTransaction, PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'
import { purchasingServiceHash, validateOrganizationApprover } from './organization-purchasing'
import { canonicalContract } from './structured-verification'
import { routeAuthorityHash, routeMandateInput, mandateDto, createRouteMandateInTransaction, RouteMandateError } from './route-payment-mandate'
import { issuePurchaseEvidence } from './organization-purchase-evidence'
import { enterpriseFoundationEnabled } from './enterprise-foundation'
import { money } from './service-order-input'
import { normalizedCapabilities, planOrganizationRouteForReview, routePlanDto, routePlanInput, type RouteCandidate } from './route-planning'
import { privateProviderAccess } from './organization-private-providers'
import { freezeProviderShare, validateFrozenProviderShare, type FrozenProviderShare } from './organization-route-private-consent'
import { routePlanningEnabled } from './routing-feature-flags'

const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const reference = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const units = z.string().regex(/^[1-9][0-9]{0,77}$/)
const proposalFields = { client_reference: reference, route_id: z.uuid().optional(),
  agent_id: z.uuid().optional(), route_request: routePlanInput.optional(),
  reviewer_role_id: z.uuid(), max_daily: money, max_monthly: money, max_lifetime: money,
  mandate: routeMandateInput }
export const organizationRouteInput = z.discriminatedUnion('version', [
  z.object({ ...proposalFields, version: z.literal(1), max_lifetime_gas_cost_wei: units }).strict(),
  z.object({ ...proposalFields, version: z.literal(2), max_lifetime_fee_token_cost_units: units }).strict(),
  z.object({ ...proposalFields, version: z.literal(3), provider_share_ids: z.array(z.uuid()).min(1).max(20), max_lifetime_gas_cost_wei: units }).strict(),
  z.object({ ...proposalFields, version: z.literal(4), provider_share_ids: z.array(z.uuid()).min(1).max(20), max_lifetime_fee_token_cost_units: units }).strict(),
]).superRefine((input, context) => {
  if (input.route_id ? input.agent_id || input.route_request : !input.agent_id || !input.route_request) {
    context.addIssue({ code: 'custom', message: 'Provide an existing route_id or an agent_id and exact route_request' })
  }
  if ('provider_share_ids' in input && (input.route_id || new Set(input.provider_share_ids).size !== input.provider_share_ids.length)) context.addIssue({code:'custom',message:'Private review requires an original embedded route request and distinct accepted shares'})
  const payment = input.mandate.payment
  const invalidPayment = (input.version === 1 || input.version === 3)
    ? payment.rail !== 'evm' || payment.chain_id !== 1 || BigInt(payment.max_gas_cost_wei) > BigInt(input.max_lifetime_gas_cost_wei)
    : payment.rail !== 'mpp' || payment.chain_id !== 4217 || !('fee_token_address' in payment)
      || payment.fee_token_address !== payment.token_address || BigInt(payment.max_fee_token_cost_units) > BigInt(input.max_lifetime_fee_token_cost_units)
  if (invalidPayment || input.mandate.max_attempts !== 1 || input.mandate.max_retry_budget !== 0
    || input.mandate.max_aggregate > input.max_daily || input.max_daily > input.max_monthly || input.max_monthly > input.max_lifetime
  ) context.addIssue({ code: 'custom', message: 'Review one bounded L1 or Tempo execution with explicit original fees, independently scoped public/private authority and no paid retry' })
})
export const organizationRouteDecision = z.object({ version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), client_reference: reference,
  authority_hash: z.string().regex(/^[a-f0-9]{64}$/), approve: z.literal(true) }).strict()
type Grant = typeof grants.$inferSelect
type Plan = typeof route_plans.$inferSelect
type Mandate = typeof route_payment_mandates.$inferSelect
type FrozenBase = { route_hash: string; candidate_hash: string; mandate_terms_hash: string;
  max_daily_minor: number; max_monthly_minor: number; max_lifetime_minor: number;
  services: { id: string; seller_id: string; contract_hash: string }[] }
type FrozenTempo = FrozenBase & { version: 2; max_lifetime_fee_token_cost_units: string }
type FrozenPrivateL1 = FrozenBase & { version: 3; provider_shares: FrozenProviderShare[]; max_lifetime_gas_cost_wei: string }
type FrozenPrivateTempo = FrozenBase & { version: 4; provider_shares: FrozenProviderShare[]; max_lifetime_fee_token_cost_units: string }
type Frozen = FrozenBase & { max_lifetime_gas_cost_wei: string } | FrozenTempo | FrozenPrivateL1 | FrozenPrivateTempo
function isTempo(terms: Frozen): terms is FrozenTempo | FrozenPrivateTempo { return 'version' in terms && (terms.version === 2 || terms.version === 4) }
function isPrivate(terms: Frozen): terms is FrozenPrivateL1 | FrozenPrivateTempo { return 'version' in terms && (terms.version === 3 || terms.version === 4) }
function version(terms: Frozen) { return 'version' in terms ? terms.version : 1 as const }
function fail(code: string, status = 409): never { throw new PurchasingError(code, status) }
function enabled() { if (!enterpriseFoundationEnabled()) fail('ORGANIZATION_ROUTE_DISABLED', 503) }
function authority(row: Pick<Grant,'organization_id'|'route_id'|'mandate_id'|'owner_account_id'|'buyer_id'|'agent_id'|'team_id'|'cost_center'|'reviewer_role_id'|'reviewer_account_id'|'request_hash'>, terms: Frozen) {
  return hash({ kind: `organization-route-authority-v${version(terms)}`, ...row, terms })
}
function frozen(row: Grant): Frozen {
  try {
    const terms: Frozen = JSON.parse(row.terms_json)
    const identity = { organization_id: row.organization_id, route_id: row.route_id, mandate_id: row.mandate_id,
      owner_account_id: row.owner_account_id, buyer_id: row.buyer_id, agent_id: row.agent_id, team_id: row.team_id,
      cost_center: row.cost_center, reviewer_role_id: row.reviewer_role_id, reviewer_account_id: row.reviewer_account_id, request_hash: row.request_hash }
    if (![1,2,3,4].includes(version(terms)) || authority(identity,terms) !== row.authority_hash || !terms.services.length
      || [terms.max_daily_minor,terms.max_monthly_minor,terms.max_lifetime_minor].some(value => !Number.isSafeInteger(value) || value < 1)
      || !units.safeParse(isTempo(terms) ? terms.max_lifetime_fee_token_cost_units : terms.max_lifetime_gas_cost_wei).success)
      fail('ORGANIZATION_ROUTE_CONTRACT_INVALID')
    return terms
  } catch { return fail('ORGANIZATION_ROUTE_CONTRACT_INVALID') }
}
async function organization(id: string, source: PurchasingSource) {
  const [org] = await source.select().from(organizations).where(eq(organizations.id,id)).limit(1)
  if (!org) fail('ORGANIZATION_NOT_FOUND',404)
  return org
}
async function current(row: Grant, plan: Plan, mandate: Mandate, source: PurchasingSource, approved = true) {
  enabled()
  if (!plan || !mandate) fail('ORGANIZATION_ROUTE_CONTRACT_INVALID')
  const terms = frozen(row), org = await organization(row.organization_id,source)
  const reviewed = mandateDto(mandate).terms
  if (isTempo(terms) ? reviewed.payment.rail !== 'mpp' || reviewed.payment.chain_id !== 4217
    || !('fee_token_address' in reviewed.payment) || reviewed.payment.fee_token_address !== reviewed.payment.token_address
    || reviewed.token_decimals !== 6 || reviewed.token_usd_price !== 1 || reviewed.fee_token_decimals !== 6
    : reviewed.payment.rail !== 'evm' || reviewed.payment.chain_id !== 1) fail('ORGANIZATION_ROUTE_SCOPE_CHANGED')
  if (org.owner_account_id !== row.owner_account_id) fail('ORGANIZATION_ROUTE_OWNER_CHANGED')
  if (!['pending','approved'].includes(row.state) || approved && row.state !== 'approved') fail('ORGANIZATION_ROUTE_APPROVAL_REQUIRED')
  if (mandate.id !== row.mandate_id || mandate.route_id !== row.route_id || mandate.buyer_id !== row.buyer_id
    || mandate.owner_account_id !== row.owner_account_id || mandate.organization_route_authorization_id !== row.id || mandate.state !== 'active' || mandate.expires_at <= new Date()
    || plan.id !== row.route_id || plan.buyer_id !== row.buyer_id || routeAuthorityHash(plan) !== terms.route_hash
    || hash(JSON.parse(plan.candidates_json)) !== terms.candidate_hash || mandateDto(mandate).terms_hash !== terms.mandate_terms_hash)
    fail('ORGANIZATION_ROUTE_SCOPE_CHANGED')
  if (row.state === 'approved' && (!row.approved_at || !row.decision_reference || row.decision_hash !== hash({ version: version(terms), client_reference: row.decision_reference, authority_hash: row.authority_hash, approve: true }))) fail('ORGANIZATION_ROUTE_DECISION_INVALID')
  const [assignment] = await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id,row.agent_id)).limit(1)
  const [link] = await source.select().from(agent_owners).where(and(eq(agent_owners.agentId,row.agent_id),eq(agent_owners.userId,row.owner_account_id))).limit(1)
  const [agent] = await source.select().from(agents).where(eq(agents.id,row.agent_id)).limit(1)
  const [owner] = await source.select().from(users).where(eq(users.id,row.owner_account_id)).limit(1)
  if (!link || !agent || agent.status !== 'active' || agent.archivedAt || !owner || owner.is_banned
    || row.buyer_id !== `user_agent_${row.agent_id}` || !assignment || assignment.organization_id !== row.organization_id
    || assignment.team_id !== row.team_id || assignment.cost_center !== row.cost_center) fail('ORGANIZATION_ROUTE_ASSIGNMENT_CHANGED')
  if (row.team_id) {
    const [team] = await source.select().from(organization_teams).where(and(eq(organization_teams.id,row.team_id),eq(organization_teams.organization_id,row.organization_id))).limit(1)
    if (!team || team.status !== 'active') fail('ORGANIZATION_ROUTE_DEPARTMENT_CHANGED')
  }
  await validateOrganizationApprover(source,row.organization_id,row.reviewer_role_id,row.reviewer_account_id,row.team_id,mandate.max_aggregate_minor)
  if (isPrivate(terms)) {
    if (!terms.provider_shares.length || terms.provider_shares.length !== terms.services.length) fail('ORGANIZATION_ROUTE_CONTRACT_INVALID')
    for (const consent of terms.provider_shares) await validateFrozenProviderShare(source,consent,row.buyer_id,row.organization_id,terms.services)
  }
  return terms
}
export async function proposeOrganizationRoute(orgId: string, actor: string, input: z.output<typeof organizationRouteInput>) {
  return purchasingTransaction(async source => {
    const org = await organization(orgId,source)
    if (org.owner_account_id !== actor) fail('ORGANIZATION_NOT_FOUND',404)
    const requestHash = hash(input)
    const [prior] = await source.select().from(grants).where(and(eq(grants.organization_id,orgId),eq(grants.client_reference,input.client_reference))).limit(1)
    if (prior) {
      if (prior.owner_account_id !== actor || prior.request_hash !== requestHash) fail('ORGANIZATION_ROUTE_REFERENCE_CONFLICT')
      return { authorization: await dto(prior,source,actor), idempotent: true }
    }
    enabled()
    let plan: Plan | undefined
    if (input.route_id) [plan] = await source.select().from(route_plans).where(eq(route_plans.id,input.route_id)).limit(1)
    else if (input.agent_id && input.route_request) {
      const buyerId = `user_agent_${input.agent_id}`, request = input.route_request
      if (!routePlanningEnabled(buyerId)) fail('ROUTE_PLANNING_DISABLED', 503)
      const planned = await planOrganizationRouteForReview(request,buyerId,orgId,actor,'provider_share_ids' in input ? input.provider_share_ids : undefined,source)
      if (!planned.candidates.length) fail('ORGANIZATION_ROUTE_CANDIDATES_INVALID')
      const [priorPlan] = await source.select().from(route_plans).where(eq(route_plans.client_reference,request.client_reference)).limit(1)
      if (priorPlan) fail('ORGANIZATION_ROUTE_PLAN_REFERENCE_CONFLICT')
      const now = new Date()
      ;[plan] = await source.insert(route_plans).values({ id: randomUUID(), buyer_id: buyerId, client_reference: request.client_reference,
        objective: request.objective, required_capabilities: JSON.stringify(normalizedCapabilities(request.required_capabilities)),
        input_json: JSON.stringify(request.input), max_budget_minor: request.max_budget.amount, currency: 'USD',
        deadline_seconds: request.deadline_seconds ?? null, verification_policy: JSON.stringify(request.verification),
        payment_policy: JSON.stringify(request.payment_policy), provider_requirements_json: JSON.stringify(request.provider_requirements),
        retry_policy: JSON.stringify(request.retry_policy), candidates_json: JSON.stringify(planned.candidates),
        state: 'planned', created_at: now, updated_at: now, expires_at: new Date(now.getTime()+5*60_000) }).returning()
    }
    if (!plan || !plan.buyer_id.startsWith('user_agent_')) fail('ROUTE_NOT_FOUND',404)
    const [existing] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.route_id,plan.id)).limit(1)
    if (existing) fail('ORGANIZATION_ROUTE_ORIGINAL_MANDATE_REQUIRED')
    const agentId = plan.buyer_id.slice('user_agent_'.length)
    const [assignment] = await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id,agentId)).limit(1)
    if (!assignment || assignment.organization_id !== orgId) fail('ORGANIZATION_ROUTE_ASSIGNMENT_CHANGED')
    const [reviewer] = await source.select().from(organization_purchasing_roles).where(eq(organization_purchasing_roles.id,input.reviewer_role_id)).limit(1)
    if (!reviewer || reviewer.account_id === actor) fail('ORGANIZATION_ROUTE_INDEPENDENT_REVIEW_REQUIRED',403)
    const candidates: RouteCandidate[] = JSON.parse(plan.candidates_json), services: Frozen['services'] = [], providerShares: FrozenProviderShare[] = []
    if (!candidates.length || candidates.length > 20) fail('ORGANIZATION_ROUTE_CANDIDATES_INVALID')
    for (const candidate of candidates) {
      const [service] = await source.select().from(service_definitions).where(eq(service_definitions.id,candidate.service_id)).limit(1)
      if (service && !input.mandate.approved_providers.includes(service.seller_id)) continue
      if (!service || service.visibility !== ('provider_share_ids' in input ? 'organization' : 'public') || candidate.payment_rail !== input.mandate.payment.rail
        || service.price_minor !== Math.round(Number(candidate.pricing.amount)*100)) fail('ORGANIZATION_ROUTE_CANDIDATES_CHANGED')
      if ('provider_share_ids' in input) {
        const [share] = await source.select().from(organization_provider_shares).where(and(eq(organization_provider_shares.service_id,service.id),inArray(organization_provider_shares.id,input.provider_share_ids))).limit(1)
        const accepted = await privateProviderAccess(service,plan.buyer_id,share?.id,source)
        if (!accepted || accepted.organization_id !== orgId) fail('ORGANIZATION_ROUTE_PRIVATE_SCOPE_CHANGED')
        providerShares.push(freezeProviderShare(accepted))
      }
      services.push({ id: service.id, seller_id: service.seller_id, contract_hash: purchasingServiceHash(service) })
    }
    if (!services.length || input.mandate.approved_providers.some(provider => !services.some(service => service.seller_id === provider))) fail('ORGANIZATION_ROUTE_CANDIDATES_INVALID')
    const result = await createRouteMandateInTransaction(source,plan.id,actor,{ ...input.mandate,
      max_aggregate: (input.mandate.max_aggregate / 100).toFixed(2),
      max_per_execution: (input.mandate.max_per_execution / 100).toFixed(2),
      max_retry_budget: (input.mandate.max_retry_budget / 100).toFixed(2) })
    const [mandate] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id,result.mandate.id)).limit(1)
    const identity = { organization_id: orgId, route_id: plan.id, mandate_id: mandate.id, owner_account_id: actor,
      buyer_id: plan.buyer_id, agent_id: agentId, team_id: assignment.team_id, cost_center: assignment.cost_center,
      reviewer_role_id: reviewer.id, reviewer_account_id: reviewer.account_id, request_hash: requestHash }
    const baseTerms: FrozenBase = { route_hash: routeAuthorityHash(plan), candidate_hash: hash(candidates), mandate_terms_hash: result.mandate.terms_hash,
      services, max_daily_minor: input.max_daily, max_monthly_minor: input.max_monthly, max_lifetime_minor: input.max_lifetime,
    }
    if ('provider_share_ids' in input && (providerShares.length !== input.provider_share_ids.length || !providerShares.every(share=>input.provider_share_ids.includes(share.id)))) fail('ORGANIZATION_ROUTE_PRIVATE_SCOPE_CHANGED')
    const terms: Frozen = input.version === 1 ? {...baseTerms,max_lifetime_gas_cost_wei:input.max_lifetime_gas_cost_wei}
      : input.version === 2 ? {...baseTerms,version:2,max_lifetime_fee_token_cost_units:input.max_lifetime_fee_token_cost_units}
      : input.version === 3 ? {...baseTerms,version:3,provider_shares:providerShares,max_lifetime_gas_cost_wei:input.max_lifetime_gas_cost_wei}
      : {...baseTerms,version:4,provider_shares:providerShares,max_lifetime_fee_token_cost_units:input.max_lifetime_fee_token_cost_units}
    const [row] = await source.insert(grants).values({ id: randomUUID(), ...identity, client_reference: input.client_reference,
      authority_hash: authority(identity,terms), terms_json: JSON.stringify(terms), created_at: new Date() }).returning()
    const [bound] = await source.update(route_payment_mandates).set({ organization_route_authorization_id: row.id }).where(eq(route_payment_mandates.id,mandate.id)).returning()
    await current(row,plan,bound,source,false)
    return { authorization: await dto(row,source,actor), idempotent: false }
  })
}
async function access(row: Grant, actor: string, source: PurchasingSource) {
  const org = await organization(row.organization_id,source)
  if (org.owner_account_id === actor) return
  if (row.reviewer_account_id !== actor) fail('ORGANIZATION_ROUTE_NOT_FOUND',404)
  const [mandate] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id,row.mandate_id)).limit(1)
  if (!mandate) fail('ORGANIZATION_ROUTE_CONTRACT_INVALID')
  await validateOrganizationApprover(source,row.organization_id,row.reviewer_role_id,actor,row.team_id,mandate.max_aggregate_minor)
}
async function dto(row: Grant, source: PurchasingSource, actor: string) {
  const terms = frozen(row), [plan] = await source.select().from(route_plans).where(eq(route_plans.id,row.route_id)).limit(1)
  const [mandate] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id,row.mandate_id)).limit(1)
  const [use] = await source.select().from(uses).where(eq(uses.authorization_id,row.id)).limit(1)
  if (!plan || !mandate) fail('ORGANIZATION_ROUTE_CONTRACT_INVALID')
  if (routeAuthorityHash(plan) !== terms.route_hash || hash(JSON.parse(plan.candidates_json)) !== terms.candidate_hash
    || mandateDto(mandate).terms_hash !== terms.mandate_terms_hash) fail('ORGANIZATION_ROUTE_SCOPE_CHANGED')
  return { id: row.id, organization_id: row.organization_id, route_id: row.route_id, buyer_id: row.buyer_id, team_id: row.team_id,
    cost_center: row.cost_center, reviewer_account_id: row.reviewer_account_id, client_reference: row.client_reference,
    viewer_role: actor === row.reviewer_account_id ? 'reviewer' as const : 'owner' as const,
    review_url: `/organizations/${row.organization_id}/route-authorizations/${row.id}`,
    authority_hash: row.authority_hash, state: row.state, approved_at: row.approved_at, revoked_at: row.revoked_at,
    version: version(terms), decision: row.decision_reference ? { version: version(terms), client_reference: row.decision_reference, authority_hash: row.authority_hash, approve: true as const } : null,
    route: { ...routePlanDto(plan,true), route_hash: terms.route_hash },
    terms, mandate: mandateDto(mandate), use: use ? { ...use, ...(isTempo(terms) ? { tempo_fee: await originalTempoFee(source,row,use,mandate) } : {}) } : null }
}
export async function inspectOrganizationRoute(orgId: string, id: string, actor: string) {
  const [row] = await db.select().from(grants).where(and(eq(grants.id,id),eq(grants.organization_id,orgId))).limit(1)
  if (!row) fail('ORGANIZATION_ROUTE_NOT_FOUND',404)
  await access(row,actor,db)
  return dto(row,db,actor)
}
export async function findOrganizationRoute(orgId: string, reference: string, actor: string) {
  const org = await organization(orgId,db)
  if (org.owner_account_id !== actor) fail('ORGANIZATION_NOT_FOUND',404)
  const [row] = await db.select().from(grants).where(and(eq(grants.organization_id,orgId),eq(grants.client_reference,reference))).limit(1)
  if (!row) fail('ORGANIZATION_ROUTE_NOT_FOUND',404)
  return dto(row,db,actor)
}
export async function approveOrganizationRoute(orgId: string, id: string, actor: string, input: z.output<typeof organizationRouteDecision>) {
  return purchasingTransaction(async source => {
    const [row] = await source.select().from(grants).where(and(eq(grants.id,id),eq(grants.organization_id,orgId))).limit(1)
    if (!row) fail('ORGANIZATION_ROUTE_NOT_FOUND',404)
    await access(row,actor,source)
    if (actor !== row.reviewer_account_id || actor === row.owner_account_id) fail('ORGANIZATION_ROUTE_REVIEWER_REQUIRED',403)
    const decision = hash(input)
    if (row.decision_hash) {
      if (row.decision_hash !== decision) fail('ORGANIZATION_ROUTE_DECISION_CONFLICT')
      return { authorization: await dto(row,source,actor), idempotent: true }
    }
    if (input.authority_hash !== row.authority_hash) fail('ORGANIZATION_ROUTE_REVIEW_CHANGED')
    if (input.version !== version(frozen(row))) fail('ORGANIZATION_ROUTE_DECISION_VERSION_MISMATCH')
    const [plan] = await source.select().from(route_plans).where(eq(route_plans.id,row.route_id)).limit(1)
    const [mandate] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id,row.mandate_id)).limit(1)
    await current(row,plan,mandate,source,false)
    if (plan.state !== 'planned' || plan.service_order_id) fail('ORGANIZATION_ROUTE_NOT_AUTHORIZABLE')
    const [approved] = await source.update(grants).set({ state: 'approved', decision_reference: input.client_reference,
      decision_hash: decision, approved_at: new Date() }).where(and(eq(grants.id,row.id),eq(grants.state,'pending'))).returning()
    if (!approved) fail('ORGANIZATION_ROUTE_STATE_CHANGED')
    return { authorization: await dto(approved,source,actor), idempotent: false }
  })
}
export async function revokeOrganizationRoute(orgId: string, id: string, actor: string) {
  return purchasingTransaction(async source => {
    const [row] = await source.select().from(grants).where(and(eq(grants.id,id),eq(grants.organization_id,orgId))).limit(1)
    if (!row) fail('ORGANIZATION_ROUTE_NOT_FOUND',404)
    await access(row,actor,source)
    if (row.state === 'revoked') return { authorization: await dto(row,source,actor), idempotent: true }
    const [revoked] = await source.update(grants).set({ state: 'revoked', revoked_at: new Date() }).where(eq(grants.id,row.id)).returning()
    return { authorization: await dto(revoked,source,actor), idempotent: false }
  })
}
async function routeGuard<T>(run: () => Promise<T>): Promise<T> {
  try { return await run() } catch (error) {
    if (error instanceof PurchasingError) throw new RouteMandateError(error.code,error.status)
    throw error
  }
}
async function originalTempoFee(source: PurchasingSource, row: Grant, use: typeof uses.$inferSelect, mandate: Mandate) {
  const terms = frozen(row), payment = mandateDto(mandate).terms.payment
  const [fee] = await source.select().from(tempoFees).where(eq(tempoFees.authorization_id,row.id)).limit(1)
  if (!isTempo(terms) || !fee || payment.rail !== 'mpp' || !('fee_token_address' in payment)
    || fee.chain_id !== 4217 || fee.chain_id !== payment.chain_id || fee.fee_token_address !== payment.fee_token_address
    || fee.authority_hash !== row.authority_hash || fee.maximum_fee_token_cost_units !== payment.max_fee_token_cost_units
    || !units.safeParse(fee.maximum_fee_token_cost_units).success || use.maximum_gas_cost_wei !== '0')
    fail('ORGANIZATION_ROUTE_USE_INVALID')
  return fee
}
export async function validateOrganizationRouteAuthority(source: PurchasingSource, mandate: Mandate, plan: Plan) {
  return routeGuard(async () => {
    const [row] = await source.select().from(grants).where(eq(grants.route_id,plan.id)).limit(1)
    if (!row) { if (mandate.organization_route_authorization_id) fail('ORGANIZATION_ROUTE_CONTRACT_INVALID'); return }
    const terms = await current(row,plan,mandate,source)
    if (plan.service_order_id) {
      const [use] = await source.select().from(uses).where(eq(uses.authorization_id,row.id)).limit(1)
      const [order] = use ? await source.select().from(service_orders).where(eq(service_orders.id,use.order_id)).limit(1) : []
      const [trade] = use ? await source.select().from(trades).where(eq(trades.id,use.trade_id)).limit(1) : []
      const [step] = use ? await source.select().from(route_funding_steps).where(eq(route_funding_steps.trade_id,use.trade_id)).limit(1) : []
      const payment = mandateDto(mandate).terms.payment
      if (!use || !order || !trade || !step || use.order_id !== plan.service_order_id || use.authority_hash !== row.authority_hash
        || use.amount_minor !== step.amount_minor || use.amount_minor !== Math.round(trade.total_cost*100) || step.order_id !== order.id || order.trade_id !== trade.id
        || order.buyer_id !== row.buyer_id || trade.buyer_id !== row.buyer_id || step.mandate_id !== mandate.id || step.route_id !== plan.id
        || step.terms_hash !== mandateDto(mandate).terms_hash || trade.payment_rail !== payment.rail
        || !isTempo(terms) && (payment.rail !== 'evm' || use.maximum_gas_cost_wei !== payment.max_gas_cost_wei)) fail('ORGANIZATION_ROUTE_USE_INVALID')
      if (isPrivate(terms) && order.private_provider_share_id !== terms.provider_shares.find(value=>value.service_id===order.service_id)?.id) fail('ORGANIZATION_ROUTE_USE_INVALID')
      if (isTempo(terms)) await originalTempoFee(source,row,use,mandate)
    }
  })
}
export async function organizationRoutePurchaseEvidence(source: PurchasingSource, routeId: string, mandateId: string,
  service: typeof service_definitions.$inferSelect, totalMinor: number) {
  return routeGuard(async () => {
    const [row] = await source.select().from(grants).where(eq(grants.route_id,routeId)).limit(1)
    if (!row) return undefined
    const [plan] = await source.select().from(route_plans).where(eq(route_plans.id,routeId)).limit(1)
    const [mandate] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id,mandateId)).limit(1)
    const terms = await current(row,plan,mandate,source)
    const candidate = terms.services.find(entry => entry.id === service.id && entry.seller_id === service.seller_id)
    if (service.visibility !== (isPrivate(terms) ? 'organization' : 'public') || !candidate || candidate.contract_hash !== purchasingServiceHash(service)) fail('ORGANIZATION_ROUTE_SERVICE_CHANGED')
    return issuePurchaseEvidence({ approvalId: row.id, requestHash: row.authority_hash, buyerId: row.buyer_id,
      totalMinor, sellerId: service.seller_id, paymentRail: mandateDto(mandate).terms.payment.rail })
  })
}
export async function consumeOrganizationRouteExposure(source: PurchasingSource, input: { plan: Plan; mandateId: string;
  service: typeof service_definitions.$inferSelect; totalMinor: number; orderId: string; tradeId: string }) {
  return routeGuard(async () => {
    const [row] = await source.select().from(grants).where(eq(grants.route_id,input.plan.id)).limit(1)
    if (!row) return
    const [mandate] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id,input.mandateId)).limit(1)
    const terms = await current(row,input.plan,mandate,source), payment = mandateDto(mandate).terms.payment
    const route = await readOriginalOrganizationRouteExposure(source,row.organization_id,row.buyer_id,payment,row.id)
    const { organizationWorkflowExposure } = await import('./organization-workflow-authorizations')
    const workflow = await organizationWorkflowExposure(source,row.organization_id,row.buyer_id,payment)
    const daily=route.daily+workflow.daily, monthly=route.monthly+workflow.monthly, lifetime=route.lifetime+workflow.lifetime,
      gas=route.gas+workflow.gas, fees=route.fees+workflow.fees
    for (const [spent,limit] of [[daily,terms.max_daily_minor],[monthly,terms.max_monthly_minor],[lifetime,terms.max_lifetime_minor]])
      if (!Number.isSafeInteger(spent) || spent < 0 || spent + input.totalMinor > limit) fail('ORGANIZATION_ROUTE_GROSS_LIMIT')
    if (isTempo(terms)) {
      if (payment.rail !== 'mpp' || !('fee_token_address' in payment)) fail('ORGANIZATION_ROUTE_SCOPE_CHANGED')
      if (fees + BigInt(payment.max_fee_token_cost_units) > BigInt(terms.max_lifetime_fee_token_cost_units)) fail('ORGANIZATION_ROUTE_FEE_TOKEN_LIMIT')
    } else {
      if (payment.rail !== 'evm') fail('ORGANIZATION_ROUTE_SCOPE_CHANGED')
      if (gas + BigInt(payment.max_gas_cost_wei) > BigInt(terms.max_lifetime_gas_cost_wei)) fail('ORGANIZATION_ROUTE_GAS_LIMIT')
    }
    await source.insert(uses).values({ authorization_id: row.id, order_id: input.orderId, trade_id: input.tradeId,
      authority_hash: row.authority_hash, amount_minor: input.totalMinor, maximum_gas_cost_wei: payment.rail === 'evm' ? payment.max_gas_cost_wei : '0', created_at: new Date() })
    if (isTempo(terms) && payment.rail === 'mpp' && 'fee_token_address' in payment) await source.insert(tempoFees).values({
      authorization_id: row.id, authority_hash: row.authority_hash, chain_id: payment.chain_id,
      fee_token_address: payment.fee_token_address, maximum_fee_token_cost_units: payment.max_fee_token_cost_units })
  })
}

/** Only the immutable reviewed route can supply private reservation consent. */
export async function organizationRoutePrivateShare(source: PurchasingSource, routeId: string, mandateId: string,
  service: typeof service_definitions.$inferSelect, buyerId: string) {
  return routeGuard(async () => {
    const [row] = await source.select().from(grants).where(eq(grants.route_id,routeId)).limit(1)
    if (!row) return undefined
    const [plan] = await source.select().from(route_plans).where(eq(route_plans.id,routeId)).limit(1)
    const [mandate] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id,mandateId)).limit(1)
    const terms = await current(row,plan,mandate,source)
    if (!isPrivate(terms)) return undefined
    if (row.buyer_id !== buyerId) fail('ORGANIZATION_ROUTE_PRIVATE_SCOPE_CHANGED')
    const consent = terms.provider_shares.find(value=>value.service_id===service.id)
    if (!consent || !terms.services.some(value=>value.id===service.id && value.contract_hash===purchasingServiceHash(service))) fail('ORGANIZATION_ROUTE_PRIVATE_SCOPE_CHANGED')
    return validateFrozenProviderShare(source,consent,buyerId,row.organization_id,terms.services)
  })
}

/** Detect original private grant scope without granting fresh spend or denying recovery. */
export async function isPrivateOrganizationRoute(routeId:string) {
  const [row]=await db.select().from(grants).where(eq(grants.route_id,routeId)).limit(1)
  return !!row && isPrivate(frozen(row))
}

export async function readOriginalOrganizationRouteExposure(source:PurchasingSource,orgId:string,buyerId:string,payment:ReturnType<typeof mandateDto>['terms']['payment'],currentId='') {
    const history = await source.select({ use: uses, grant: grants }).from(uses).innerJoin(grants,eq(grants.id,uses.authorization_id))
      .where(and(eq(grants.organization_id,orgId),eq(grants.buyer_id,buyerId))).limit(10001)
    if (history.length > 10000) fail('ORGANIZATION_ROUTE_HISTORY_UNAVAILABLE',503)
    let daily = 0, monthly = 0, lifetime = 0, gas = 0n, fees = 0n
    const now = new Date(), day = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()), month = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)
    for (const entry of history) {
      const priorTerms = frozen(entry.grant)
      const [step] = await source.select().from(route_funding_steps).where(eq(route_funding_steps.trade_id,entry.use.trade_id)).limit(1)
      const [order] = await source.select().from(service_orders).where(eq(service_orders.id,entry.use.order_id)).limit(1)
      const [trade] = await source.select().from(trades).where(eq(trades.id,entry.use.trade_id)).limit(1)
      const [priorMandate] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id,entry.grant.mandate_id)).limit(1)
      const priorPayment = priorMandate && mandateDto(priorMandate).terms.payment
      if (!step || !order || !trade || !priorMandate || !priorPayment
        || step.order_id !== order.id || step.route_id !== entry.grant.route_id || step.mandate_id !== entry.grant.mandate_id
        || order.trade_id !== trade.id || trade.buyer_id !== buyerId || order.buyer_id !== buyerId
        || entry.use.authority_hash !== entry.grant.authority_hash || entry.use.amount_minor !== step.amount_minor
        || entry.use.amount_minor !== Math.round(trade.total_cost*100) || trade.payment_rail !== priorPayment.rail
        || step.terms_hash !== mandateDto(priorMandate).terms_hash
        || !isTempo(priorTerms) && (priorPayment.rail !== 'evm' || priorPayment.chain_id !== 1
          || entry.use.maximum_gas_cost_wei !== priorPayment.max_gas_cost_wei))
        fail('ORGANIZATION_ROUTE_USE_INVALID')
      lifetime += entry.use.amount_minor
      if (entry.use.created_at.getTime() >= day) daily += entry.use.amount_minor
      if (entry.use.created_at.getTime() >= month) monthly += entry.use.amount_minor
      if (isTempo(priorTerms)) {
        const fee = await originalTempoFee(source,entry.grant,entry.use,priorMandate)
        if (payment.rail === 'mpp' && 'fee_token_address' in payment && fee.chain_id === payment.chain_id
          && fee.fee_token_address === payment.fee_token_address) fees += BigInt(fee.maximum_fee_token_cost_units)
      } else gas += BigInt(entry.use.maximum_gas_cost_wei)
    }
    const [orphan] = await source.all(sql`SELECT a.id FROM organization_route_authorizations a JOIN route_funding_steps s ON s.mandate_id=a.mandate_id
      WHERE a.organization_id=${orgId} AND a.buyer_id=${buyerId} AND a.id<>${currentId}
      AND NOT EXISTS(SELECT 1 FROM organization_route_uses u WHERE u.authorization_id=a.id AND u.order_id=s.order_id AND u.trade_id=s.trade_id) LIMIT 1`)
    // Exclude only the step inserted in this transaction immediately before this hook.
    if (orphan) fail('ORGANIZATION_ROUTE_USE_INVALID')
    return {daily,monthly,lifetime,gas,fees}
}
