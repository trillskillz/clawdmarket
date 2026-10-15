import { sellerPaymentRails } from '@/lib/seller-payment-rails'
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { agents, agent_owners, bids, listings, organizations, organization_agent_assignments,
  organization_purchasing_roles, organization_teams, organization_trade_attributions,
  organization_task_authorizations as grants, organization_task_uses as uses,
  payment_controls, tasks, task_workspaces, trades, users } from './schema'
import { PurchasingError, purchasingTransaction, type PurchasingSource } from './organization-purchasing-transaction'
import { validateOrganizationApprover } from './organization-purchasing'
import { canonicalContract } from './structured-verification'
import { money } from './service-order-input'
import { paymentContract, routeMandatePaymentInput, type mandateDto } from './route-payment-mandate'
import { requirementsSchema } from './delivery-validation'
import { calculateTradeFinancials } from './settlement'
import { enterpriseFoundationEnabled } from './enterprise-foundation'
import { routeExecutionEnabled } from './routing-feature-flags'
import { getPaymentReadiness } from './payment-config'
import { payoutAddressForUser } from './external-settlement'
import { issuePurchaseEvidence } from './organization-purchase-evidence'
import { enforceAgentSpendPolicy, agentFundingPolicyFailure } from './agent-spend-policy'
import { attributeOrganizationTrade, organizationFundingBudgetFailure } from './organization-budgets'
import { buyerPolicyUsage, checkBuyerPolicyConstraints, loadBuyerSpendPolicy } from './buyer-spend-policy'
import { checkoutForTrade } from './trade-checkout'
import { NEW_PAYMENTS_CONTROL_KEY } from './payment-control'

const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const reference = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const units = z.string().regex(/^[1-9][0-9]{0,77}$/)
const identifier = z.string().min(1).max(200)
const fail = (code: string, status = 409): never => { throw new PurchasingError(code, status) }
export const organizationTaskInput = z.object({
  version: z.union([z.literal(1), z.literal(2)]), client_reference: reference,
  task_id: identifier, winning_bid_id: identifier, reviewer_role_id: z.uuid(),
  expected_total: money, max_daily: money, max_monthly: money, max_lifetime: money,
  max_lifetime_chain_fee_units: units, expires_at: z.iso.datetime({ offset: true }),
  expected_token_decimals: z.number().int().min(0).max(36), expected_token_usd_price: z.number().finite().positive(),
  payment: routeMandatePaymentInput,
}).strict().superRefine((input, ctx) => {
  const payment = input.payment
  if (input.version === 1 ? payment.rail !== 'evm' || payment.chain_id !== 1
    : payment.rail !== 'mpp' || payment.chain_id !== 4217 || payment.fee_token_address !== payment.token_address) {
    ctx.addIssue({ code: 'custom', message: 'Review Ethereum L1 native fees or configured Tempo fee-token units' })
  }
  if (input.expected_total > input.max_daily || input.max_daily > input.max_monthly || input.max_monthly > input.max_lifetime
    || BigInt(payment.rail === 'evm' ? payment.max_gas_cost_wei : payment.max_fee_token_cost_units) > BigInt(input.max_lifetime_chain_fee_units)) {
    ctx.addIssue({ code: 'custom', message: 'Review bounded gross exposure and chain fee ceilings' })
  }
})
export const organizationTaskDecision = z.object({ version: z.union([z.literal(1), z.literal(2)]),
  client_reference: reference, authority_hash: z.string().regex(/^[a-f0-9]{64}$/), approve: z.literal(true) }).strict()
export const organizationTaskCheckoutInput = organizationTaskDecision.omit({ approve: true })
type Grant = typeof grants.$inferSelect
type Payment = z.output<typeof routeMandatePaymentInput>
type Task = typeof tasks.$inferSelect
type Bid = typeof bids.$inferSelect
type Workspace = typeof task_workspaces.$inferSelect
function taskContract(task: Task, bid: Bid, workspace: Workspace) {
  return {
    task: { id: task.id, poster_agent_id: task.posterAgentId, title: task.title, description: task.description,
      required_capabilities: z.array(z.string().min(1).max(200)).max(100).parse(JSON.parse(task.requiredCapabilities || '[]')),
      budget_usd: task.budgetUsd, deadline_at: task.deadlineAt, expires_at: task.expiresAt, task_type: task.taskType,
      assigned_agent_id: task.assignedAgentId, winning_bid_id: task.winningBidId },
    bid: { id: bid.id, agent_id: bid.bidderAgentId, price_usd: bid.priceUsd, proposal: bid.message,
      estimated_hours: bid.etaSeconds === null ? null : bid.etaSeconds / 3600,
      counter_offer: { price: bid.counterOfferPrice, message: bid.counterOfferMessage, status: bid.counterOfferStatus } },
    workspace: { agreed_price: workspace.agreed_price, requirements: requirementsSchema.parse({
      output_format: workspace.output_format, acceptance_criteria: JSON.parse(workspace.acceptance_criteria),
      required_json_keys: JSON.parse(workspace.required_json_keys), minimum_sources: workspace.minimum_sources }) },
  }
}
export type TaskTerms = ReturnType<typeof taskContract> & {
  version: 1 | 2; payment: Payment; token_decimals: number; token_usd_price: number; fee_token_decimals?: number;
  expires_at: string; total_minor: number; max_daily_minor: number; max_monthly_minor: number;
  max_lifetime_minor: number; max_lifetime_chain_fee_units: string; explicit_acceptance: true;
}
function fingerprint(row: Grant, terms: TaskTerms) {
  return hash({ kind: `organization-task-authority-v${terms.version}`, organization_id: row.organization_id,
    task_id: row.task_id, winning_bid_id: row.winning_bid_id, poster_id: row.poster_id,
    owner_account_id: row.owner_account_id, buyer_id: row.buyer_id, agent_id: row.agent_id,
    seller_id: row.seller_id, seller_agent_id: row.seller_agent_id, team_id: row.team_id, cost_center: row.cost_center,
    reviewer_role_id: row.reviewer_role_id, reviewer_account_id: row.reviewer_account_id, request_hash: row.request_hash, terms })
}
function frozen(row: Grant): TaskTerms {
  try {
    const terms: TaskTerms = JSON.parse(row.terms_json)
    const payment = routeMandatePaymentInput.parse(terms.payment)
    if (![1, 2].includes(terms.version) || fingerprint(row, terms) !== row.authority_hash || terms.explicit_acceptance !== true
      || terms.task.id !== row.task_id || terms.bid.id !== row.winning_bid_id || terms.task.poster_agent_id !== row.poster_id
      || terms.bid.agent_id !== row.seller_agent_id || terms.task.assigned_agent_id !== row.seller_agent_id
      || terms.task.winning_bid_id !== row.winning_bid_id || row.buyer_id !== `user_agent_${row.agent_id}`
      || row.seller_id !== `user_agent_${row.seller_agent_id}` || row.buyer_id === row.seller_id
      || ![row.agent_id, row.buyer_id].includes(row.poster_id)
      || !Number.isInteger(terms.token_decimals) || terms.token_decimals < 0 || terms.token_decimals > 36
      || !Number.isFinite(terms.token_usd_price) || terms.token_usd_price <= 0 || !Number.isFinite(Date.parse(terms.expires_at))
      || [terms.total_minor, terms.max_daily_minor, terms.max_monthly_minor, terms.max_lifetime_minor].some(n => !Number.isSafeInteger(n) || n < 1)
      || terms.total_minor > terms.max_daily_minor || terms.max_daily_minor > terms.max_monthly_minor || terms.max_monthly_minor > terms.max_lifetime_minor
      || !units.safeParse(terms.max_lifetime_chain_fee_units).success
      || (terms.version === 1 ? payment.rail !== 'evm' || payment.chain_id !== 1
        : payment.rail !== 'mpp' || payment.chain_id !== 4217 || payment.fee_token_address !== payment.token_address
          || terms.token_decimals !== 6 || terms.token_usd_price !== 1 || terms.fee_token_decimals !== 6)
      || hash(payment) !== hash(terms.payment)
      || BigInt(feeCeiling(terms)) > BigInt(terms.max_lifetime_chain_fee_units)
      || Math.round(calculateTradeFinancials(terms.workspace.agreed_price ?? terms.bid.price_usd).totalCost * 100) !== terms.total_minor) fail('ORGANIZATION_TASK_CONTRACT_INVALID')
    requirementsSchema.parse(terms.workspace.requirements)
    return terms
  } catch { return fail('ORGANIZATION_TASK_CONTRACT_INVALID') }
}
function feeCeiling(terms: TaskTerms) { return terms.payment.rail === 'evm' ? terms.payment.max_gas_cost_wei : terms.payment.max_fee_token_cost_units }
function taskTimestamp(value: string) {
  const timestamp = Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')
  if (!Number.isFinite(timestamp)) fail('ORGANIZATION_TASK_SCOPE_CHANGED')
  return timestamp
}
async function organization(id: string, source: PurchasingSource) {
  const [row] = await source.select().from(organizations).where(eq(organizations.id, id)).limit(1)
  return row ?? fail('ORGANIZATION_NOT_FOUND', 404)
}
async function grant(orgId: string, id: string, source: PurchasingSource) {
  const [row] = await source.select().from(grants).where(and(eq(grants.id, id), eq(grants.organization_id, orgId))).limit(1)
  return row ?? fail('ORGANIZATION_TASK_NOT_FOUND', 404)
}
async function access(row: Grant, actor: string, source: PurchasingSource) {
  const org = await organization(row.organization_id, source)
  if (org.owner_account_id === actor) return
  if (actor !== row.reviewer_account_id) fail('ORGANIZATION_TASK_NOT_FOUND', 404)
  await validateOrganizationApprover(source, row.organization_id, row.reviewer_role_id, actor, row.team_id, frozen(row).total_minor)
}
async function current(row: Grant, source: PurchasingSource, approved = true) {
  const terms = frozen(row)
  if (!enterpriseFoundationEnabled() || !routeExecutionEnabled(row.buyer_id)) fail('ORGANIZATION_TASK_DISABLED', 503)
  if ((await organization(row.organization_id, source)).owner_account_id !== row.owner_account_id) fail('ORGANIZATION_TASK_OWNER_CHANGED')
  if (!['pending', 'approved'].includes(row.state) || approved && row.state !== 'approved') fail('ORGANIZATION_TASK_APPROVAL_REQUIRED')
  if (Date.parse(terms.expires_at) <= Date.now()) fail('ORGANIZATION_TASK_EXPIRED')
  if (row.state === 'approved' && (!row.approved_at || !row.decision_reference || row.decision_hash !== hash({
    version: terms.version, client_reference: row.decision_reference, authority_hash: row.authority_hash, approve: true }))) fail('ORGANIZATION_TASK_DECISION_INVALID')
  const [assignment] = await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id, row.agent_id)).limit(1)
  const [link] = await source.select().from(agent_owners).where(and(eq(agent_owners.agentId, row.agent_id), eq(agent_owners.userId, row.owner_account_id))).limit(1)
  const [agent] = await source.select().from(agents).where(eq(agents.id, row.agent_id)).limit(1)
  const [seller] = await source.select().from(agents).where(eq(agents.id, row.seller_agent_id)).limit(1)
  const participants = await source.select().from(users).where(sql`${users.id} IN (${row.owner_account_id}, ${row.buyer_id}, ${row.seller_id})`)
  if (!assignment || assignment.organization_id !== row.organization_id || assignment.team_id !== row.team_id
    || assignment.cost_center !== row.cost_center || !link || !agent || agent.status !== 'active' || agent.archivedAt
    || !seller || seller.status !== 'active' || seller.archivedAt || participants.length !== 3 || participants.some(user => user.is_banned)) fail('ORGANIZATION_TASK_ASSIGNMENT_CHANGED')
  if (row.team_id) {
    const [team] = await source.select().from(organization_teams).where(eq(organization_teams.id, row.team_id)).limit(1)
    if (!team || team.organization_id !== row.organization_id || team.status !== 'active') fail('ORGANIZATION_TASK_DEPARTMENT_CHANGED')
  }
  if (row.reviewer_account_id === row.owner_account_id) fail('ORGANIZATION_TASK_INDEPENDENT_REVIEW_REQUIRED', 403)
  const [providerReviewer] = await source.select({ id: agent_owners.agentId }).from(agent_owners)
    .where(and(eq(agent_owners.agentId, row.seller_agent_id), eq(agent_owners.userId, row.reviewer_account_id))).limit(1)
  if (providerReviewer) fail('ORGANIZATION_TASK_INDEPENDENT_REVIEW_REQUIRED', 403)
  await validateOrganizationApprover(source, row.organization_id, row.reviewer_role_id, row.reviewer_account_id, row.team_id, terms.total_minor)
  const [task] = await source.select().from(tasks).where(eq(tasks.id, row.task_id)).limit(1)
  const [bid] = await source.select().from(bids).where(eq(bids.id, row.winning_bid_id)).limit(1)
  const [workspace] = await source.select().from(task_workspaces).where(eq(task_workspaces.task_id, row.task_id)).limit(1)
  if (!task || !bid || !workspace || task.status !== 'assigned' || bid.status !== 'accepted' || bid.taskId !== task.id
    || hash(taskContract(task, bid, workspace)) !== hash({ task: terms.task, bid: terms.bid, workspace: terms.workspace })
    || task.deadlineAt && taskTimestamp(task.deadlineAt) <= Date.now() || taskTimestamp(task.expiresAt) <= Date.now()) fail('ORGANIZATION_TASK_SCOPE_CHANGED')
  const metadata = paymentContract(terms.payment)
  if (metadata.token_decimals !== terms.token_decimals || metadata.token_usd_price !== terms.token_usd_price
    || metadata.fee_token_decimals !== terms.fee_token_decimals) fail('ORGANIZATION_TASK_PAYMENT_CHANGED')
  if (!await payoutAddressForUser(row.seller_id, source)) fail('SELLER_PAYOUT_REQUIRED')
  return terms
}
async function dto(row: Grant, source: PurchasingSource, actor: string) {
  const [use] = await source.select().from(uses).where(eq(uses.authorization_id, row.id)).limit(1)
  return { id: row.id, organization_id: row.organization_id, task_id: row.task_id, winning_bid_id: row.winning_bid_id,
    buyer_id: row.buyer_id, team_id: row.team_id, cost_center: row.cost_center, client_reference: row.client_reference,
    version: frozen(row).version, state: row.state, authority_hash: row.authority_hash, terms: frozen(row),
    reviewer_account_id: row.reviewer_account_id, viewer_role: actor === row.reviewer_account_id ? 'reviewer' as const : 'owner' as const,
    approved_at: row.approved_at, revoked_at: row.revoked_at, review_url: `/organizations/${row.organization_id}/task-authorizations/${row.id}`,
    decision: row.decision_reference ? { version: frozen(row).version, client_reference: row.decision_reference,
      authority_hash: row.authority_hash, approve: true as const } : null, use: use ?? null }
}
export async function proposeOrganizationTask(orgId: string, actor: string, input: z.output<typeof organizationTaskInput>) {
  return purchasingTransaction(async source => {
    const org = await organization(orgId, source)
    if (org.owner_account_id !== actor) fail('ORGANIZATION_NOT_FOUND', 404)
    const requestHash = hash(input)
    const [prior] = await source.select().from(grants).where(and(eq(grants.organization_id, orgId), eq(grants.client_reference, input.client_reference))).limit(1)
    if (prior) {
      if (prior.request_hash !== requestHash || prior.owner_account_id !== actor) fail('ORGANIZATION_TASK_IDEMPOTENCY_CONFLICT')
      return { authorization: await dto(prior, source, actor), idempotent: true }
    }
    const [task] = await source.select().from(tasks).where(eq(tasks.id, input.task_id)).limit(1)
    const [bid] = await source.select().from(bids).where(eq(bids.id, input.winning_bid_id)).limit(1)
    const [workspace] = await source.select().from(task_workspaces).where(eq(task_workspaces.task_id, input.task_id)).limit(1)
    if (!task || !bid || !workspace || task.status !== 'assigned' || task.winningBidId !== bid.id || bid.taskId !== task.id
      || bid.status !== 'accepted' || task.assignedAgentId !== bid.bidderAgentId) fail('ORGANIZATION_TASK_NOT_AUTHORIZABLE')
    const [existing] = await source.select({ id: grants.id }).from(grants).where(and(eq(grants.task_id, task.id), sql`${grants.state} IN ('pending','approved')`)).limit(1)
    const [used] = await source.select({ id: uses.authorization_id }).from(uses).where(eq(uses.task_id, task.id)).limit(1)
    if (existing || used || workspace.trade_id) fail('ORGANIZATION_TASK_ALREADY_RESERVED')
    const agentId = task.posterAgentId.startsWith('user_agent_') ? task.posterAgentId.slice(11) : task.posterAgentId
    const buyerId = `user_agent_${agentId}`, sellerId = `user_agent_${bid.bidderAgentId}`
    const [assignment] = await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id, agentId)).limit(1)
    const [reviewer] = await source.select().from(organization_purchasing_roles).where(eq(organization_purchasing_roles.id, input.reviewer_role_id)).limit(1)
    if (!assignment || assignment.organization_id !== orgId) fail('ORGANIZATION_TASK_ASSIGNMENT_CHANGED')
    if (!reviewer || reviewer.account_id === actor || reviewer.account_id === buyerId || reviewer.account_id === sellerId) fail('ORGANIZATION_TASK_INDEPENDENT_REVIEW_REQUIRED', 403)
    const expiry = Date.parse(input.expires_at)
    if (expiry <= Date.now() || expiry > Date.now() + 86_400_000 || task.deadlineAt && expiry > taskTimestamp(task.deadlineAt)
      || expiry > taskTimestamp(task.expiresAt)) fail('ORGANIZATION_TASK_EXPIRY_INVALID', 400)
    const contract = taskContract(task, bid, workspace), quote = calculateTradeFinancials(workspace.agreed_price ?? bid.priceUsd)
    if (Math.round(quote.totalCost * 100) !== input.expected_total) fail('ORGANIZATION_TASK_QUOTE_CHANGED')
    const metadata = paymentContract(input.payment)
    if (metadata.token_decimals !== input.expected_token_decimals || metadata.token_usd_price !== input.expected_token_usd_price) fail('ORGANIZATION_TASK_PAYMENT_CHANGED')
    const terms: TaskTerms = { ...contract, version: input.version, payment: input.payment, ...metadata,
      expires_at: new Date(expiry).toISOString(), total_minor: input.expected_total, max_daily_minor: input.max_daily,
      max_monthly_minor: input.max_monthly, max_lifetime_minor: input.max_lifetime,
      max_lifetime_chain_fee_units: input.max_lifetime_chain_fee_units, explicit_acceptance: true }
    const row: Grant = { id: randomUUID(), organization_id: orgId, task_id: task.id, winning_bid_id: bid.id, poster_id: task.posterAgentId,
      owner_account_id: actor, buyer_id: buyerId, agent_id: agentId, seller_id: sellerId, seller_agent_id: bid.bidderAgentId,
      team_id: assignment.team_id, cost_center: assignment.cost_center, reviewer_role_id: reviewer.id, reviewer_account_id: reviewer.account_id,
      client_reference: input.client_reference, request_hash: requestHash, authority_hash: '', terms_json: JSON.stringify(terms),
      state: 'pending', decision_reference: null, decision_hash: null, created_at: new Date(), approved_at: null, revoked_at: null }
    row.authority_hash = fingerprint(row, terms)
    await current(row, source, false)
    await source.insert(grants).values(row)
    return { authorization: await dto(row, source, actor), idempotent: false }
  })
}
export async function inspectOrganizationTask(orgId: string, id: string, actor: string) {
  const row = await grant(orgId, id, db); await access(row, actor, db); return dto(row, db, actor)
}
export async function findOrganizationTask(orgId: string, clientReference: string, actor: string) {
  if ((await organization(orgId, db)).owner_account_id !== actor) fail('ORGANIZATION_NOT_FOUND', 404)
  const [row] = await db.select().from(grants).where(and(eq(grants.organization_id, orgId), eq(grants.client_reference, clientReference))).limit(1)
  if (!row) return fail('ORGANIZATION_TASK_NOT_FOUND', 404)
  return dto(row, db, actor)
}
export async function approveOrganizationTask(orgId: string, id: string, actor: string, input: z.output<typeof organizationTaskDecision>) {
  return purchasingTransaction(async source => {
    const row = await grant(orgId, id, source); await access(row, actor, source)
    if (actor !== row.reviewer_account_id || actor === row.owner_account_id) fail('ORGANIZATION_TASK_REVIEWER_REQUIRED', 403)
    if (row.decision_hash) {
      if (row.decision_hash !== hash(input)) fail('ORGANIZATION_TASK_DECISION_CONFLICT')
      return { authorization: await dto(row, source, actor), idempotent: true }
    }
    const terms = await current(row, source, false)
    if (input.version !== terms.version || input.authority_hash !== row.authority_hash) fail('ORGANIZATION_TASK_REVIEW_CHANGED')
    const [updated] = await source.update(grants).set({ state: 'approved', decision_reference: input.client_reference,
      decision_hash: hash(input), approved_at: new Date() }).where(and(eq(grants.id, id), eq(grants.state, 'pending'))).returning()
    if (!updated) return fail('ORGANIZATION_TASK_STATE_CHANGED')
    return { authorization: await dto(updated, source, actor), idempotent: false }
  })
}
export async function revokeOrganizationTask(orgId: string, id: string, actor: string) {
  return purchasingTransaction(async source => {
    const row = await grant(orgId, id, source); await access(row, actor, source)
    if (row.state === 'revoked') return { authorization: await dto(row, source, actor), idempotent: true }
    const [updated] = await source.update(grants).set({ state: 'revoked', revoked_at: new Date() }).where(eq(grants.id, id)).returning()
    return { authorization: await dto(updated, source, actor), idempotent: false }
  })
}

/** Historical financial binding never grants permission for another send. */
export async function originalTaskPayment(source: PurchasingSource, tradeId: string) {
  const [use] = await source.select().from(uses).where(eq(uses.trade_id, tradeId)).limit(1)
  if (!use) {
    const [orphan] = await source.all(sql`SELECT a.id FROM organization_task_authorizations a JOIN task_workspaces w ON w.task_id=a.task_id WHERE w.trade_id=${tradeId} LIMIT 1`)
    if (orphan) fail('ORGANIZATION_TASK_USE_INVALID')
    return null
  }
  const [authorization] = await source.select().from(grants).where(eq(grants.id, use.authorization_id)).limit(1)
  if (!authorization) return fail('ORGANIZATION_TASK_USE_INVALID')
  const terms = frozen(authorization)
  const [trade] = await source.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
  const [workspace] = await source.select().from(task_workspaces).where(eq(task_workspaces.task_id, authorization.task_id)).limit(1)
  const [attribution] = await source.select().from(organization_trade_attributions).where(eq(organization_trade_attributions.trade_id, tradeId)).limit(1)
  const [listing] = trade ? await source.select().from(listings).where(eq(listings.id, trade.listing_id)).limit(1) : []
  const quote = calculateTradeFinancials(terms.workspace.agreed_price ?? terms.bid.price_usd)
  if (!['approved', 'revoked'].includes(authorization.state) || !authorization.approved_at || !authorization.decision_reference
    || authorization.decision_hash !== hash({ version: terms.version, client_reference: authorization.decision_reference, authority_hash: authorization.authority_hash, approve: true })
    || !Number.isFinite(use.created_at.getTime()) || use.created_at < authorization.approved_at
    || !trade || !workspace || !listing || !attribution || workspace.trade_id !== tradeId || use.task_id !== authorization.task_id
    || use.winning_bid_id !== authorization.winning_bid_id || use.authority_hash !== authorization.authority_hash
    || use.amount_minor !== terms.total_minor || use.request_hash !== hash({ version: terms.version, client_reference: use.client_reference, authority_hash: authorization.authority_hash })
    || trade.buyer_id !== authorization.buyer_id || trade.seller_id !== authorization.seller_id || listing.seller_id !== authorization.seller_id
    || trade.payment_rail !== terms.payment.rail || trade.client_reference !== `organization-task:${authorization.id}`
    || trade.item_price !== quote.itemPrice || trade.platform_fee !== quote.platformFee || trade.total_cost !== quote.totalCost
    || trade.amount !== quote.sellerAmount || trade.seller_amount !== quote.sellerAmount || trade.fee !== quote.devAmount || trade.dev_amount !== quote.devAmount
    || attribution.organization_id !== authorization.organization_id || attribution.agent_id !== authorization.agent_id
    || attribution.team_id !== authorization.team_id || attribution.cost_center !== authorization.cost_center || attribution.total_minor !== terms.total_minor
    || use.chain_id !== terms.payment.chain_id || use.maximum_chain_fee_units !== feeCeiling(terms)
    || use.fee_token_decimals !== (terms.payment.rail === 'evm' ? 18 : 6)
    || use.fee_token_address !== (terms.payment.rail === 'mpp' ? terms.payment.fee_token_address : null)) fail('ORGANIZATION_TASK_USE_INVALID')
  const [duplicate] = await source.all(sql`SELECT id FROM service_orders WHERE trade_id=${tradeId}
    UNION ALL SELECT approval_id FROM organization_purchase_uses WHERE trade_id=${tradeId}
    UNION ALL SELECT account_id FROM organization_spending_uses WHERE trade_id=${tradeId}
    UNION ALL SELECT authorization_id FROM organization_listing_uses WHERE trade_id=${tradeId} LIMIT 1`)
  if (duplicate) fail('ORGANIZATION_TASK_USE_INVALID')
  return { authorization, terms, use, trade }
}
export async function organizationTaskExposure(source: PurchasingSource, orgId: string, buyerId: string, payment: ReturnType<typeof mandateDto>['terms']['payment'], excludeTradeId = '') {
  const history = await source.select({ use: uses }).from(uses).innerJoin(grants, eq(grants.id, uses.authorization_id))
    .where(and(eq(grants.organization_id, orgId), eq(grants.buyer_id, buyerId))).limit(10001)
  if (history.length > 10000) fail('ORGANIZATION_TASK_HISTORY_UNAVAILABLE', 503)
  let daily = 0, monthly = 0, lifetime = 0, gas = 0n, fees = 0n
  const now = new Date(), day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  for (const { use } of history) {
    const original = await originalTaskPayment(source, use.trade_id)
    if (!original) return fail('ORGANIZATION_TASK_USE_INVALID')
    if (use.trade_id === excludeTradeId) continue
    lifetime += use.amount_minor
    if (use.created_at.getTime() >= day) daily += use.amount_minor
    if (use.created_at.getTime() >= month) monthly += use.amount_minor
    if (original.terms.payment.rail === 'evm') gas += BigInt(use.maximum_chain_fee_units)
    else if (payment.rail === 'mpp' && 'fee_token_address' in payment && payment.chain_id === use.chain_id && payment.fee_token_address === use.fee_token_address) fees += BigInt(use.maximum_chain_fee_units)
    if (![daily, monthly, lifetime].every(Number.isSafeInteger)) fail('ORGANIZATION_TASK_EXPOSURE_INVALID')
  }
  const [orphan] = await source.all(sql`SELECT a.id FROM organization_task_authorizations a JOIN task_workspaces w ON w.task_id=a.task_id
    WHERE a.organization_id=${orgId} AND a.buyer_id=${buyerId} AND w.trade_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM organization_task_uses u WHERE u.task_id=w.task_id AND u.trade_id=w.trade_id) LIMIT 1`)
  if (orphan) fail('ORGANIZATION_TASK_EXPOSURE_INVALID')
  return { daily, monthly, lifetime, gas, fees }
}
async function exposure(row: Grant, terms: TaskTerms, source: PurchasingSource, excludeTradeId = '') {
  const { readOriginalOrganizationRouteExposure } = await import('./organization-route-authorizations')
  const { organizationWorkflowExposure } = await import('./organization-workflow-authorizations')
  const route = await readOriginalOrganizationRouteExposure(source, row.organization_id, row.buyer_id, terms.payment)
  const workflow = await organizationWorkflowExposure(source, row.organization_id, row.buyer_id, terms.payment)
  const task = await organizationTaskExposure(source, row.organization_id, row.buyer_id, terms.payment, excludeTradeId)
  const { organizationListingExposure } = await import('./organization-listing-uses')
  const listing = await organizationListingExposure(source, row.organization_id, row.buyer_id, terms.payment)
  if (route.daily + workflow.daily + task.daily + listing.daily + terms.total_minor > terms.max_daily_minor) fail('ORGANIZATION_TASK_DAILY_EXPOSURE')
  if (route.monthly + workflow.monthly + task.monthly + listing.monthly + terms.total_minor > terms.max_monthly_minor) fail('ORGANIZATION_TASK_MONTHLY_EXPOSURE')
  if (route.lifetime + workflow.lifetime + task.lifetime + listing.lifetime + terms.total_minor > terms.max_lifetime_minor) fail('ORGANIZATION_TASK_LIFETIME_EXPOSURE')
  const priorFees = terms.payment.rail === 'evm' ? route.gas + workflow.gas + task.gas + listing.gas : route.fees + workflow.fees + task.fees + listing.fees
  if (priorFees + BigInt(feeCeiling(terms)) > BigInt(terms.max_lifetime_chain_fee_units)) fail('ORGANIZATION_TASK_FEE_EXPOSURE')
}
function evidence(row: Grant, terms: TaskTerms) {
  return issuePurchaseEvidence({ approvalId: row.id, requestHash: row.authority_hash, buyerId: row.buyer_id,
    totalMinor: terms.total_minor, sellerId: row.seller_id, paymentRail: terms.payment.rail })
}
type ActualScope = { rail: string; chainId: number; tokenAddress: string; payerAddress: string; treasuryAddress?: string; txHash?: string | null }
export async function taskFundingEligibility(trade: typeof trades.$inferSelect, source: PurchasingSource = db, actualScope?: ActualScope): Promise<string | null> {
  try {
    const original = await originalTaskPayment(source, trade.id)
    if (!original) return null
    const { authorization: row, terms } = original
    await current(row, source)
    if (actualScope && (actualScope.rail !== terms.payment.rail || actualScope.chainId !== terms.payment.chain_id
      || actualScope.tokenAddress.toLowerCase() !== terms.payment.token_address || actualScope.payerAddress.toLowerCase() !== terms.payment.payer_address
      || actualScope.treasuryAddress !== undefined && actualScope.treasuryAddress.toLowerCase() !== terms.payment.treasury_address
      || actualScope.treasuryAddress === undefined && !actualScope.txHash)) return 'ORGANIZATION_TASK_PAYMENT_CHANGED'
    await exposure(row, terms, source, trade.id)
    const deployment = await agentFundingPolicyFailure(trade, source); if (deployment) return deployment
    const organizationReason = await organizationFundingBudgetFailure(trade, source); if (organizationReason) return organizationReason
    const policy = await loadBuyerSpendPolicy(trade.buyer_id, source)
    if (policy) {
      const reason = checkBuyerPolicyConstraints(policy.policy, { totalMinor: terms.total_minor, sellerId: row.seller_id,
        capabilities: terms.task.required_capabilities, paymentRail: terms.payment.rail, verificationMethods: ['buyer_review'], purchaseEvidence: evidence(row, terms) })
      if (reason) return reason
      const usage = await buyerPolicyUsage(row.buyer_id, new Date(), source)
      if (policy.policy.max_daily !== undefined && usage.reserved_or_spent_today_minor > policy.policy.max_daily) return 'BUYER_DAILY_LIMIT'
      if (policy.policy.max_monthly !== undefined && usage.reserved_or_spent_month_minor > policy.policy.max_monthly) return 'BUYER_MONTHLY_LIMIT'
    }
    return null
  } catch (error) {
    if (error instanceof PurchasingError) return error.code
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
    if (error instanceof SyntaxError || error instanceof z.ZodError) return 'ORGANIZATION_TASK_CONTRACT_INVALID'
    throw error
  }
}
function checkoutDto(row: Grant, terms: TaskTerms, trade: typeof trades.$inferSelect | null) {
  return { ok: true as const, authorization_id: row.id, authority_hash: row.authority_hash, task_id: row.task_id,
    trade, checkout: trade ? checkoutForTrade(trade) : null, workspace_url: `/taskboard/${row.task_id}`,
    payment_authority: { id: row.id, kind: terms.version === 1 ? 'organization_task_v1' as const : 'organization_task_v2' as const,
      authority_hash: row.authority_hash, terms: { payment: terms.payment, token_decimals: terms.token_decimals,
        token_usd_price: terms.token_usd_price, ...(terms.fee_token_decimals === undefined ? {} : { fee_token_decimals: terms.fee_token_decimals }), expires_at: terms.expires_at } } }
}
export async function inspectOrganizationTaskCheckout(orgId: string, id: string, buyerId: string) {
  const row = await grant(orgId, id, db)
  if (row.buyer_id !== buyerId) fail('ORGANIZATION_TASK_NOT_FOUND', 404)
  const [use] = await db.select().from(uses).where(eq(uses.authorization_id, row.id)).limit(1)
  const original = use ? await originalTaskPayment(db, use.trade_id) : null
  return checkoutDto(row, frozen(row), original?.trade ?? null)
}
export async function checkoutOrganizationTask(orgId: string, id: string, buyerId: string, input: z.output<typeof organizationTaskCheckoutInput>) {
  return purchasingTransaction(async source => {
    const row = await grant(orgId, id, source)
    if (row.buyer_id !== buyerId) fail('ORGANIZATION_TASK_NOT_FOUND', 404)
    const [use] = await source.select().from(uses).where(eq(uses.authorization_id, row.id)).limit(1)
    if (use) {
      if (use.request_hash !== hash(input)) fail('ORGANIZATION_TASK_CHECKOUT_CONFLICT')
      const original = await originalTaskPayment(source, use.trade_id)
      if (!original) return fail('ORGANIZATION_TASK_USE_INVALID')
      return { ...checkoutDto(row, original.terms, original.trade), created: false }
    }
    const terms = await current(row, source)
    if (input.authority_hash !== row.authority_hash || input.version !== terms.version) fail('ORGANIZATION_TASK_REVIEW_CHANGED')
    const [workspace] = await source.select().from(task_workspaces).where(eq(task_workspaces.task_id, row.task_id)).limit(1)
    const [priorTaskUse] = await source.select().from(uses).where(eq(uses.task_id, row.task_id)).limit(1)
    if (!workspace || workspace.trade_id || priorTaskUse) fail('ORGANIZATION_TASK_ALREADY_RESERVED')
    const [pause] = await source.select().from(payment_controls).where(eq(payment_controls.key, NEW_PAYMENTS_CONTROL_KEY)).limit(1)
    if (process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED === 'true' || pause?.paused === 1) fail('NEW_PAYMENTS_PAUSED', 503)
    await exposure(row, terms, source)
    const quote = calculateTradeFinancials(terms.workspace.agreed_price ?? terms.bid.price_usd)
    await enforceAgentSpendPolicy(source, { agentId: row.agent_id, buyerId, totalCost: quote.totalCost,
      sellerId: row.seller_id, paymentRail: terms.payment.rail, capabilities: terms.task.required_capabilities,
      verificationMethods: ['buyer_review'], purchaseEvidence: evidence(row, terms) })
    if (!(await sellerPaymentRails(row.seller_id, source)).supported_payment_rails.includes(terms.payment.rail)) fail('SELLER_PAYMENT_RAIL_UNSUPPORTED')
    const [listing] = await source.insert(listings).values({ seller_id: row.seller_id, category: 'bounties',
      title: terms.task.title, description: terms.task.description, price_bankr: quote.itemPrice, status: 'sold' }).returning()
    const readiness = getPaymentReadiness()
    const [trade] = await source.insert(trades).values({ listing_id: listing.id, buyer_id: buyerId, seller_id: row.seller_id,
      amount: quote.sellerAmount, fee: quote.devAmount, item_price: quote.itemPrice, platform_fee: quote.platformFee,
      total_cost: quote.totalCost, seller_amount: quote.sellerAmount, dev_amount: quote.devAmount,
      dev_wallet: terms.payment.rail === 'mpp' ? readiness.mpp.feeRecipient : readiness.evm.feeRecipient,
      payout_status: 'pending', payment_rail: terms.payment.rail, client_reference: `organization-task:${row.id}`,
      payment_due_at: new Date(Math.min(Date.now() + 30 * 60_000, Date.parse(terms.expires_at))).toISOString(), status: 'pending' }).returning()
    await attributeOrganizationTrade(source, row.agent_id, trade, terms.total_minor)
    await source.update(task_workspaces).set({ trade_id: trade.id }).where(eq(task_workspaces.task_id, row.task_id))
    await source.insert(uses).values({ authorization_id: row.id, task_id: row.task_id, trade_id: trade.id,
      winning_bid_id: row.winning_bid_id, authority_hash: row.authority_hash, client_reference: input.client_reference,
      request_hash: hash(input), amount_minor: terms.total_minor, chain_id: terms.payment.chain_id,
      fee_token_address: terms.payment.rail === 'mpp' ? terms.payment.fee_token_address : null,
      fee_token_decimals: terms.payment.rail === 'evm' ? 18 : 6, maximum_chain_fee_units: feeCeiling(terms), created_at: new Date() })
    await originalTaskPayment(source, trade.id)
    return { ...checkoutDto(row, terms, trade), created: true }
  })
}

/** Every companion review blocks generic creation; only checkout above can mint a reviewed trade. */
export async function genericTaskFundingGuard(source: PurchasingSource, taskId: string) {
  const [row] = await source.select().from(grants).where(eq(grants.task_id, taskId)).limit(1)
  if (row) fail('ORGANIZATION_TASK_REVIEWED_CHECKOUT_REQUIRED')
}
