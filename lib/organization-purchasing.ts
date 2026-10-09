import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { organizations, organization_memberships, organization_teams, organization_agent_assignments, agent_owners, agents,
  organization_purchasing_roles as roles, organization_purchase_requests as requests, organization_purchase_approvals as approvals,
  organization_purchase_uses as uses, organization_audit_events, service_definitions, service_orders, trades } from './schema'
import { serviceOrderInput, money } from './service-order-input'
import { captureServiceExecutionContract } from './service-execution-contract'
import { storedServiceCapabilities } from './route-service-eligibility'
import { enterpriseFoundationEnabled } from './enterprise-foundation'
import { PurchasingError, purchasingTransaction, type PurchasingSource } from './organization-purchasing-transaction'
import { issuePurchaseEvidence, validPurchaseEvidence, type VerifiedPurchase } from './organization-purchase-evidence'
export { PurchasingError } from './organization-purchasing-transaction'

const reference = z.string().trim().min(8).max(200)
const expires = z.string().datetime({ offset: true }).transform(value => new Date(value))
export const purchasingRoleInput = z.object({ version: z.literal(1), client_reference: reference, account_id: z.string().min(1).max(200),
  team_id: z.string().uuid().nullable(), role: z.enum(['requester', 'approver']), max_purchase: money, expires_at: expires }).strict()
export const purchaseRequestInput = z.object({ version: z.literal(1), client_reference: reference, buyer_agent_id: z.string().regex(/^(?:agent_)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),
  service_id: z.string().uuid(), requester_role_id: z.string().uuid().nullable(), reviewer_role_id: z.string().uuid().nullable(),
  order: serviceOrderInput.omit({ purchasing_approval_id: true }).extend({ payment_rail: z.enum(['credit', 'evm', 'mpp']), max_total: money }),
  expires_at: expires }).strict()
export const purchaseDecisionInput = z.object({ version: z.literal(1), client_reference: reference, request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  approve: z.literal(true), expires_at: expires }).strict()

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value)
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
const unexpired = (value: Date) => Number.isFinite(value.getTime()) && value.getTime() > Date.now()
const enabled = () => { if (!enterpriseFoundationEnabled()) throw new PurchasingError('PURCHASING_DISABLED', 503) }
function expiration(value: Date, maxMilliseconds: number) {
  if (!Number.isFinite(value.getTime()) || value.getTime() <= Date.now() || value.getTime() > Date.now() + maxMilliseconds)
    throw new PurchasingError('PURCHASING_EXPIRY_INVALID', 400)
}
async function organization(id: string, source: PurchasingSource) {
  const [org] = await source.select().from(organizations).where(eq(organizations.id, id)).limit(1)
  if (!org) throw new PurchasingError('ORGANIZATION_NOT_FOUND', 404)
  return org
}
async function member(org: string, account: string, source: PurchasingSource) {
  if (account.startsWith('user_agent_')) throw new PurchasingError('PURCHASING_MEMBER_REQUIRED', 403)
  const [row] = await source.select().from(organization_memberships).where(and(eq(organization_memberships.organization_id, org),
    eq(organization_memberships.account_id, account), eq(organization_memberships.status, 'active'))).limit(1)
  if (!row) throw new PurchasingError('PURCHASING_MEMBER_REQUIRED', 403)
}
async function department(org: string, id: string | null, source: PurchasingSource) {
  if (!id) return
  const [team] = await source.select().from(organization_teams).where(and(eq(organization_teams.id, id), eq(organization_teams.organization_id, org))).limit(1)
  if (!team || team.status !== 'active') throw new PurchasingError('PURCHASING_DEPARTMENT_UNAVAILABLE')
}
async function role(id: string, org: Awaited<ReturnType<typeof organization>>, account: string, kind: 'requester' | 'approver',
  team: string | null, amount: number, source: PurchasingSource) {
  const [row] = await source.select().from(roles).where(eq(roles.id, id)).limit(1)
  if (!row || row.organization_id !== org.id || row.owner_account_id !== org.owner_account_id || row.account_id !== account
    || row.role !== kind || row.state !== 'active' || !unexpired(row.expires_at)
    || !Number.isSafeInteger(row.max_purchase_minor) || amount > row.max_purchase_minor || row.max_purchase_minor < 1
    || (row.team_id !== null && row.team_id !== team)) throw new PurchasingError('PURCHASING_ROLE_INVALID', 403)
  await member(org.id, account, source); await department(org.id, row.team_id, source)
  return row
}
async function audit(org: string, actor: string, action: typeof organization_audit_events.$inferInsert['action'], source: PurchasingSource) {
  await source.insert(organization_audit_events).values({ id: randomUUID(), organization_id: org, actor_account_id: actor, action, created_at: new Date() })
}
export async function grantPurchasingRole(orgId: string, actor: string, input: z.output<typeof purchasingRoleInput>) {
  return purchasingTransaction(async tx => {
    const org = await organization(orgId, tx)
    if (org.owner_account_id !== actor) throw new PurchasingError('ORGANIZATION_NOT_FOUND', 404)
    const fingerprint = hash(input)
    const [prior] = await tx.select().from(roles).where(and(eq(roles.organization_id, orgId), eq(roles.client_reference, input.client_reference))).limit(1)
    if (prior) {
      if (prior.request_hash !== fingerprint || prior.owner_account_id !== actor) throw new PurchasingError('PURCHASING_REFERENCE_CONFLICT')
      return { role: prior, idempotent: true }
    }
    enabled(); expiration(input.expires_at, 90 * 86400_000); await member(orgId, input.account_id, tx); await department(orgId, input.team_id, tx)
    const [row] = await tx.insert(roles).values({ id: randomUUID(), organization_id: orgId, owner_account_id: actor,
      account_id: input.account_id, team_id: input.team_id, role: input.role, max_purchase_minor: input.max_purchase,
      client_reference: input.client_reference, request_hash: fingerprint, expires_at: input.expires_at, created_at: new Date() }).returning()
    await audit(orgId, actor, 'purchasing_role_created', tx)
    return { role: row, idempotent: false }
  })
}
export async function listPurchasingRoles(orgId: string, actor: string) {
  const org = await organization(orgId, db)
  if (org.owner_account_id !== actor) await member(orgId, actor, db)
  return db.select().from(roles).where(org.owner_account_id === actor ? eq(roles.organization_id, orgId)
    : and(eq(roles.organization_id, orgId), eq(roles.account_id, actor))).limit(100)
}
export async function revokePurchasingRole(orgId: string, actor: string, roleId: string) {
  return purchasingTransaction(async tx => {
    const org = await organization(orgId, tx)
    if (org.owner_account_id !== actor) throw new PurchasingError('ORGANIZATION_NOT_FOUND', 404)
    const [row] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organization_id, orgId))).limit(1)
    if (!row) throw new PurchasingError('PURCHASING_ROLE_NOT_FOUND', 404)
    if (row.state === 'revoked') return row
    const [updated] = await tx.update(roles).set({ state: 'revoked', revoked_at: new Date() }).where(eq(roles.id, roleId)).returning()
    await audit(orgId, actor, 'purchasing_role_revoked', tx); return updated
  })
}
function serviceHash(service: typeof service_definitions.$inferSelect) {
  const capabilities = storedServiceCapabilities(service.capabilities)
  if (!capabilities?.length || service.status !== 'active' || !Number.isSafeInteger(service.price_minor) || service.price_minor < 1)
    throw new PurchasingError('PURCHASING_SERVICE_UNAVAILABLE')
  return hash({ contract: captureServiceExecutionContract(service, capabilities), price_minor: service.price_minor, currency: service.currency })
}
async function currentRequest(row: typeof requests.$inferSelect, source: PurchasingSource) {
  const org = await organization(row.organization_id, source)
  if (org.owner_account_id !== row.owner_account_id) throw new PurchasingError('PURCHASING_OWNER_CHANGED')
  if (row.state === 'cancelled' || !unexpired(row.expires_at)) throw new PurchasingError('PURCHASING_REQUEST_INACTIVE')
  const [assignment] = await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id, row.agent_id)).limit(1)
  const [agent] = await source.select().from(agents).where(eq(agents.id, row.agent_id)).limit(1)
  if (!agent || agent.status !== 'active' || agent.archivedAt) throw new PurchasingError('PURCHASING_BUYER_INACTIVE')
  const [owner] = await source.select().from(agent_owners).where(and(eq(agent_owners.agentId, row.agent_id), eq(agent_owners.userId, row.owner_account_id))).limit(1)
  if (!owner || !assignment || assignment.organization_id !== row.organization_id || assignment.team_id !== row.team_id
    || assignment.cost_center !== row.cost_center || row.buyer_id !== `user_agent_${row.agent_id}`) throw new PurchasingError('PURCHASING_BUYER_ASSIGNMENT_CHANGED')
  await department(org.id, row.team_id, source)
  if (row.requester_role_id) await role(row.requester_role_id, org, row.requester_account_id, 'requester', row.team_id, row.amount_minor, source)
  else if (row.requester_account_id !== org.owner_account_id) throw new PurchasingError('PURCHASING_ROLE_INVALID', 403)
  const [service] = await source.select().from(service_definitions).where(eq(service_definitions.id, row.service_id)).limit(1)
  if (!service || serviceHash(service) !== row.service_hash) throw new PurchasingError('PURCHASING_QUOTE_CHANGED')
  return { org, service }
}
export async function createPurchaseRequest(orgId: string, actor: string, input: z.output<typeof purchaseRequestInput>) {
  return purchasingTransaction(async tx => {
    const org = await organization(orgId, tx), fingerprint = hash(input)
    const [prior] = await tx.select().from(requests).where(and(eq(requests.organization_id, orgId), eq(requests.client_reference, input.client_reference))).limit(1)
    if (prior) {
      if (prior.requester_account_id !== actor) throw new PurchasingError('PURCHASE_NOT_FOUND', 404)
      await purchaseAccess(prior, actor, tx)
      if (prior.request_hash !== fingerprint) throw new PurchasingError('PURCHASING_REFERENCE_CONFLICT')
      return { request: prior, idempotent: true }
    }
    enabled(); expiration(input.expires_at, 24 * 3600_000)
    const [assignment] = await tx.select().from(organization_agent_assignments).where(and(eq(organization_agent_assignments.agent_id, input.buyer_agent_id),
      eq(organization_agent_assignments.organization_id, orgId))).limit(1)
    if (!assignment) throw new PurchasingError('PURCHASING_BUYER_ASSIGNMENT_CHANGED')
    const [service] = await tx.select().from(service_definitions).where(eq(service_definitions.id, input.service_id)).limit(1)
    if (!service) throw new PurchasingError('PURCHASING_SERVICE_UNAVAILABLE')
    const amount = service.price_minor + Math.round(service.price_minor * .05)
    if (amount > input.order.max_total || input.order.expected_price !== undefined && input.order.expected_price !== service.price_minor)
      throw new PurchasingError('PURCHASING_QUOTE_CHANGED')
    if (actor === org.owner_account_id) {
      if (input.requester_role_id !== null) throw new PurchasingError('PURCHASING_ROLE_INVALID', 403)
    } else {
      if (!input.requester_role_id) throw new PurchasingError('PURCHASING_ROLE_REQUIRED', 403)
      await role(input.requester_role_id, org, actor, 'requester', assignment.team_id, amount, tx)
    }
    if (input.reviewer_role_id) {
      const [reviewer] = await tx.select().from(roles).where(eq(roles.id, input.reviewer_role_id)).limit(1)
      if (!reviewer || reviewer.account_id === actor) throw new PurchasingError('PURCHASING_INDEPENDENT_REVIEWER_REQUIRED', 403)
      await role(reviewer.id, org, reviewer.account_id, 'approver', assignment.team_id, amount, tx)
    }
    const proposed = { id: randomUUID(), organization_id: orgId, owner_account_id: org.owner_account_id,
      buyer_id: `user_agent_${input.buyer_agent_id}`, agent_id: input.buyer_agent_id, team_id: assignment.team_id, cost_center: assignment.cost_center,
      service_id: service.id, requester_account_id: actor, requester_role_id: input.requester_role_id, reviewer_role_id: input.reviewer_role_id,
      client_reference: input.client_reference, request_hash: fingerprint, service_hash: serviceHash(service), order_json: canonical(input.order),
      amount_minor: amount, payment_rail: input.order.payment_rail, state: 'open' as const, expires_at: input.expires_at,
      created_at: new Date(), cancelled_at: null }
    await currentRequest(proposed, tx)
    const [row] = await tx.insert(requests).values(proposed).returning()
    await audit(orgId, actor, 'purchase_requested', tx); return { request: row, idempotent: false }
  })
}
async function purchaseAccess(row: typeof requests.$inferSelect, actor: string, source: PurchasingSource) {
  const org = await organization(row.organization_id, source)
  if (org.owner_account_id === actor) return
  if (row.requester_account_id === actor) { await member(org.id, actor, source); return }
  if (row.reviewer_role_id) {
    const [reviewer] = await source.select().from(roles).where(eq(roles.id, row.reviewer_role_id)).limit(1)
    if (reviewer?.account_id === actor) { await role(reviewer.id, org, actor, 'approver', row.team_id, row.amount_minor, source); return }
  }
  throw new PurchasingError('PURCHASE_NOT_FOUND', 404)
}
export async function inspectPurchase(orgId: string, requestId: string, actor: string) {
  const [row] = await db.select().from(requests).where(and(eq(requests.id, requestId), eq(requests.organization_id, orgId))).limit(1)
  if (!row) throw new PurchasingError('PURCHASE_NOT_FOUND', 404)
  await purchaseAccess(row, actor, db)
  const [approval] = await db.select().from(approvals).where(eq(approvals.request_id, requestId)).limit(1)
  const [use] = approval ? await db.select().from(uses).where(eq(uses.approval_id, approval.id)).limit(1) : []
  const org = await organization(orgId, db)
  const owner = org.owner_account_id === actor
  const reviewer = row.reviewer_role_id ? (await db.select().from(roles).where(eq(roles.id, row.reviewer_role_id)).limit(1))[0]?.account_id === actor : false
  return { request: row, approval: approval || null, use: use || null, permissions: {
    approve: !approval && row.state === 'open' && (owner || reviewer && row.requester_account_id !== actor),
    cancel: row.state !== 'cancelled' && (owner || row.requester_account_id === actor),
    revoke: approval?.state === 'active' && (owner || approval.approver_account_id === actor),
  } }
}
export async function approvePurchase(orgId: string, requestId: string, actor: string, input: z.output<typeof purchaseDecisionInput>) {
  return purchasingTransaction(async tx => {
    const [row] = await tx.select().from(requests).where(and(eq(requests.id, requestId), eq(requests.organization_id, orgId))).limit(1)
    if (!row) throw new PurchasingError('PURCHASE_NOT_FOUND', 404)
    await purchaseAccess(row, actor, tx)
    const org = await organization(orgId, tx)
    if (org.owner_account_id !== actor) {
      if (!row.reviewer_role_id || row.requester_account_id === actor) throw new PurchasingError('PURCHASING_REVIEWER_REQUIRED', 403)
      await role(row.reviewer_role_id, org, actor, 'approver', row.team_id, row.amount_minor, tx)
    }
    const decision = hash({ actor, input })
    const [prior] = await tx.select().from(approvals).where(eq(approvals.request_id, requestId)).limit(1)
    if (prior) {
      if (prior.decision_hash !== decision) throw new PurchasingError('PURCHASING_DECISION_CONFLICT')
      return { approval: prior, idempotent: true }
    }
    enabled(); expiration(input.expires_at, 24 * 3600_000)
    if (input.request_hash !== row.request_hash || input.expires_at > row.expires_at) throw new PurchasingError('PURCHASING_DECISION_MISMATCH')
    await currentRequest(row, tx)
    const [approval] = await tx.insert(approvals).values({ id: randomUUID(), request_id: row.id, organization_id: orgId,
      owner_account_id: org.owner_account_id, approver_account_id: actor, approver_role_id: actor === org.owner_account_id ? null : row.reviewer_role_id,
      client_reference: input.client_reference, request_hash: row.request_hash, decision_hash: decision, expires_at: input.expires_at, created_at: new Date() }).returning()
    await tx.update(requests).set({ state: 'approved' }).where(eq(requests.id, requestId))
    await audit(orgId, actor, 'purchase_approved', tx); return { approval, idempotent: false }
  })
}
export async function stopPurchase(orgId: string, requestId: string, actor: string, target: 'request' | 'approval') {
  return purchasingTransaction(async tx => {
    const [row] = await tx.select().from(requests).where(and(eq(requests.id, requestId), eq(requests.organization_id, orgId))).limit(1)
    if (!row) throw new PurchasingError('PURCHASE_NOT_FOUND', 404)
    await purchaseAccess(row, actor, tx)
    const org = await organization(orgId, tx)
    if (target === 'request') {
      if (org.owner_account_id !== actor && row.requester_account_id !== actor) throw new PurchasingError('PURCHASING_REQUESTER_REQUIRED', 403)
      if (row.state === 'cancelled') return row
      const [updated] = await tx.update(requests).set({ state: 'cancelled', cancelled_at: new Date() }).where(eq(requests.id, requestId)).returning()
      await audit(orgId, actor, 'purchase_cancelled', tx); return updated
    }
    const [approval] = await tx.select().from(approvals).where(eq(approvals.request_id, row.id)).limit(1)
    if (!approval) throw new PurchasingError('PURCHASING_APPROVAL_NOT_FOUND', 404)
    if (org.owner_account_id !== actor && approval.approver_account_id !== actor) throw new PurchasingError('PURCHASING_REVIEWER_REQUIRED', 403)
    if (approval.state === 'revoked') return approval
    const [updated] = await tx.update(approvals).set({ state: 'revoked', revoked_at: new Date() }).where(eq(approvals.id, approval.id)).returning()
    await audit(orgId, actor, 'purchase_approval_revoked', tx); return updated
  })
}

export async function validatePurchaseApproval(source: PurchasingSource, args: { approvalId: string; buyerId: string; service: typeof service_definitions.$inferSelect;
  request: z.output<typeof serviceOrderInput>; totalMinor: number; rail: string; orderId?: string; tradeId?: string }) {
  enabled()
  const [approval] = await source.select().from(approvals).where(eq(approvals.id, args.approvalId)).limit(1)
  if (!approval || approval.state !== 'active' || !unexpired(approval.expires_at)) throw new PurchasingError('PURCHASING_APPROVAL_INACTIVE')
  const [row] = await source.select().from(requests).where(eq(requests.id, approval.request_id)).limit(1)
  if (!row || row.buyer_id !== args.buyerId) throw new PurchasingError('PURCHASING_APPROVAL_NOT_FOUND', 404)
  const { org } = await currentRequest(row, source)
  if (row.state !== 'approved' || approval.owner_account_id !== org.owner_account_id || approval.request_hash !== row.request_hash
    || row.service_id !== args.service.id || row.service_hash !== serviceHash(args.service) || row.amount_minor !== args.totalMinor || row.payment_rail !== args.rail)
    throw new PurchasingError('PURCHASING_APPROVAL_MISMATCH')
  if (approval.approver_role_id) await role(approval.approver_role_id, org, approval.approver_account_id, 'approver', row.team_id, row.amount_minor, source)
  else if (approval.approver_account_id !== org.owner_account_id) throw new PurchasingError('PURCHASING_ROLE_INVALID', 403)
  const { purchasing_approval_id: ignored, ...order } = args.request
  void ignored
  if (canonical(order) !== row.order_json) throw new PurchasingError('PURCHASING_APPROVAL_MISMATCH')
  const [use] = await source.select().from(uses).where(eq(uses.approval_id, approval.id)).limit(1)
  if (use && (!args.orderId || use.order_id !== args.orderId || use.trade_id !== args.tradeId || use.buyer_id !== args.buyerId
    || use.request_hash !== row.request_hash || use.amount_minor !== args.totalMinor)) throw new PurchasingError('PURCHASING_APPROVAL_CONSUMED')
  if (args.orderId && !use) throw new PurchasingError('PURCHASING_CONSUMPTION_MISSING')
  return issuePurchaseEvidence({ approvalId: approval.id, requestHash: row.request_hash, buyerId: row.buyer_id, totalMinor: row.amount_minor,
    sellerId: args.service.seller_id, paymentRail: args.rail })
}
export async function consumePurchaseApproval(source: PurchasingSource, evidence: VerifiedPurchase, orderId: string, tradeId: string) {
  if (!validPurchaseEvidence(evidence)) throw new PurchasingError('PURCHASING_APPROVAL_INVALID')
  await source.insert(uses).values({ approval_id: evidence.approvalId, order_id: orderId, trade_id: tradeId, buyer_id: evidence.buyerId,
    request_hash: evidence.requestHash, amount_minor: evidence.totalMinor, created_at: new Date() })
}
export async function fundingPurchaseEvidence(order: typeof service_orders.$inferSelect, trade: typeof trades.$inferSelect,
  service: typeof service_definitions.$inferSelect, source: PurchasingSource) {
  if (!order.purchasing_approval_id) return undefined
  const [approval] = await source.select().from(approvals).where(eq(approvals.id, order.purchasing_approval_id)).limit(1)
  const [row] = approval ? await source.select().from(requests).where(eq(requests.id, approval.request_id)).limit(1) : []
  if (!row) throw new PurchasingError('PURCHASING_APPROVAL_NOT_FOUND', 404)
  const request = JSON.parse(row.order_json) as z.output<typeof serviceOrderInput>
  if (order.service_id !== row.service_id || order.buyer_id !== row.buyer_id || order.client_reference !== request.client_reference
    || order.objective !== request.objective || hash(JSON.parse(order.input_json)) !== hash(request.input)
    || hash(JSON.parse(order.provider_requirements_json)) !== hash(request.provider_requirements)) throw new PurchasingError('PURCHASING_APPROVAL_MISMATCH')
  return validatePurchaseApproval(source, { approvalId: approval.id, buyerId: trade.buyer_id, service, request,
    totalMinor: Math.round(trade.total_cost * 100), rail: trade.payment_rail, orderId: order.id, tradeId: trade.id })
}

/** Original checkout replay binds the exact saved body without regranting current spending authority. */
export async function originalPurchaseOrderMatches(approvalId: string, buyerId: string, orderId: string,
  request: z.output<typeof serviceOrderInput>, source: PurchasingSource = db) {
  const [use] = await source.select().from(uses).where(eq(uses.approval_id, approvalId)).limit(1)
  if (!use || use.buyer_id !== buyerId || use.order_id !== orderId) return false
  const [approval] = await source.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1)
  const [row] = approval ? await source.select().from(requests).where(eq(requests.id, approval.request_id)).limit(1) : []
  const { purchasing_approval_id: ignored, ...order } = request
  void ignored
  return !!row && use.request_hash === row.request_hash && row.order_json === canonical(order)
}
