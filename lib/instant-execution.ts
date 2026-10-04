import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { instant_services, instant_sessions, instant_calls, organization_agent_assignments, payment_controls } from './schema'
import { changeCredit } from './account-credit'
import { checkServiceInput, outputSchemaV1, verifyOutputSchema } from './verification-policy'
import { normalizeCapability } from './capabilities'
import { canonicalContract } from './structured-verification'
import { enforceBuyerSpendPolicy, loadBuyerSpendPolicy, checkBuyerPolicyConstraints, buyerPolicyUsage, BuyerSpendPolicyError } from './buyer-spend-policy'
import { enforceAgentSpendPolicy, getAgentSpendSnapshot } from './agent-spend-policy'
import { isPublicMarketplaceSeller } from './listing-visibility'
import { referenceFleetPaidServicePublicationLocked } from './reference-fleet-control'
import { routeAdmissionFailure } from './route-control'
import { getPaymentReadiness } from './payment-config'
import { withKeyedWriteLock } from './service-reservation-lock'
import type { RequestPrincipal } from './request-principal'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Session = typeof instant_sessions.$inferSelect
type Call = typeof instant_calls.$inferSelect
const reference = z.string().trim().min(8).max(128)
const payload = z.record(z.string().max(100), z.unknown()).refine(value => Buffer.byteLength(JSON.stringify(value)) <= 8192)
export const instantServiceInput = z.object({
  title: z.string().trim().min(5).max(100),
  capabilities: z.array(z.string().transform((value, ctx) => {
    const id = normalizeCapability(value)
    if (!id) { ctx.addIssue({ code: 'custom', message: 'Unknown capability' }); return z.NEVER }
    return id
  })).min(1).max(20),
  input_schema: outputSchemaV1, output_schema: outputSchemaV1,
  unit_price_minor: z.number().int().min(1).max(100),
  max_concurrency: z.number().int().min(1).max(100).default(1),
  deadline_seconds: z.number().int().min(1).max(60).default(30),
}).strict()
export const instantSessionInput = z.object({
  client_reference: reference, budget_minor: z.number().int().min(1).max(10000),
  expected_unit_price_minor: z.number().int().min(1).max(100),
  expires_in_seconds: z.number().int().min(60).max(3600),
  acceptance: z.literal('schema_v1'), payment_rail: z.literal('credit'),
}).strict()
export const instantCallInput = z.object({ client_reference: reference, input: payload }).strict()
export const instantClaimInput = z.object({ lease_token: z.string().min(32).max(128) }).strict()
export const instantResultInput = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('completed'), lease_token: instantClaimInput.shape.lease_token, output: payload }).strict(),
  z.object({ outcome: z.literal('failed'), lease_token: instantClaimInput.shape.lease_token }).strict(),
])
export class InstantError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const states = ['pending', 'claimed'] as const
function enabled() { return process.env.NODE_ENV !== 'production' || process.env.CLAWDMARKET_INSTANT_EXECUTION_ENABLED === 'true' }
function requireEnabled() { if (!enabled()) throw new InstantError('INSTANT_EXECUTION_DISABLED', 503) }
async function write<T>(fn: (tx: Tx) => Promise<T>) {
  return withKeyedWriteLock('instant-execution', async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await db.transaction(fn) } catch (error) {
        let cause: unknown = error, busy = false
        for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
          const e = cause as { message?: string; cause?: unknown }
          busy ||= /SQLITE_BUSY|database is locked/i.test(e.message || ''); cause = e.cause
        }
        if (!busy || attempt >= 5) throw error
        await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
  })
}
function contract(session: Session) {
  return z.object({ version: z.literal(1), seller_id: z.string(), capabilities: z.array(z.string()),
    input_schema: outputSchemaV1, output_schema: outputSchemaV1, unit_price_minor: z.number().int().positive(),
    deadline_seconds: z.number().int().positive(), acceptance: z.literal('schema_v1'), max_concurrency: z.number().int().positive(),
  }).strict().parse(JSON.parse(session.contract_json))
}
export function instantServiceDto(service: typeof instant_services.$inferSelect) {
  const { input_schema, output_schema, capabilities, ...rest } = service
  return { ...rest, capabilities: JSON.parse(capabilities), input_schema: JSON.parse(input_schema), output_schema: JSON.parse(output_schema),
    execution_mode: 'instant', metering: 'one_successful_call', payment_rail: 'credit', enabled: enabled() }
}
export function instantSessionDto(session: Session) {
  const { contract_json, ...rest } = session
  return { ...rest, contract: JSON.parse(contract_json), currency: 'USD', payment_rail: 'credit',
    available_budget_minor: session.balance_minor - session.held_minor }
}
export function instantCallDto(call: Call) {
  const { lease_token_hash: _secret, input_json, output_json, receipt_json, ...rest } = call
  return { ...rest, input: JSON.parse(input_json), output: output_json ? JSON.parse(output_json) : null,
    receipt: receipt_json ? JSON.parse(receipt_json) : null }
}
async function newAuthority(tx: Tx) {
  requireEnabled()
  if (!getPaymentReadiness().credit.enabled) throw new InstantError('CREDIT_UNAVAILABLE', 503)
  const [control] = await tx.select().from(payment_controls).where(eq(payment_controls.key, 'new_payments')).limit(1)
  if (process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED === 'true' || control?.paused) throw new InstantError('NEW_PAYMENTS_PAUSED', 503)
  if (await routeAdmissionFailure(tx)) throw new InstantError('ROUTE_EXECUTION_PAUSED', 503)
}
export async function createInstantService(principal: RequestPrincipal, input: z.output<typeof instantServiceInput>) {
  requireEnabled()
  if (await referenceFleetPaidServicePublicationLocked(principal.agentId)) throw new InstantError('REFERENCE_FLEET_PAID_SERVICES_LOCKED')
  if (!await isPublicMarketplaceSeller(principal.userId)) throw new InstantError('SELLER_NOT_PUBLIC')
  const [service] = await db.insert(instant_services).values({ seller_id: principal.userId, title: input.title,
    capabilities: JSON.stringify([...new Set(input.capabilities)]), input_schema: JSON.stringify(input.input_schema),
    output_schema: JSON.stringify(input.output_schema), unit_price_minor: input.unit_price_minor,
    max_concurrency: input.max_concurrency, deadline_seconds: input.deadline_seconds }).returning()
  return instantServiceDto(service)
}
export async function openInstantSession(principal: RequestPrincipal, serviceId: string, input: z.output<typeof instantSessionInput>) {
  return write(async tx => {
    const [prior] = await tx.select().from(instant_sessions).where(and(eq(instant_sessions.buyer_id, principal.userId), eq(instant_sessions.client_reference, input.client_reference))).limit(1)
    if (prior) {
      const agreed = contract(prior)
      if (prior.service_id !== serviceId || prior.budget_minor !== input.budget_minor || agreed.unit_price_minor !== input.expected_unit_price_minor
        || prior.expires_at.getTime() - prior.created_at.getTime() !== input.expires_in_seconds * 1000) throw new InstantError('IDEMPOTENCY_CONFLICT')
      return { session: instantSessionDto(prior), idempotent: true }
    }
    await newAuthority(tx)
    const [service] = await tx.select().from(instant_services).where(eq(instant_services.id, serviceId)).limit(1)
    if (!service || service.status !== 'active') throw new InstantError('INSTANT_SERVICE_UNAVAILABLE', 404)
    if (principal.userId === service.seller_id) throw new InstantError('SELF_PURCHASE_BLOCKED')
    if (!await isPublicMarketplaceSeller(service.seller_id)) throw new InstantError('SELLER_NOT_PUBLIC')
    if (await referenceFleetPaidServicePublicationLocked(service.seller_id.startsWith('user_agent_') ? service.seller_id.slice('user_agent_'.length) : null)) throw new InstantError('REFERENCE_FLEET_PAID_SERVICES_LOCKED')
    if (service.unit_price_minor !== input.expected_unit_price_minor || input.budget_minor < service.unit_price_minor) throw new InstantError('PRICE_OR_BUDGET_MISMATCH')
    // Organization budgets currently attribute contracted trades only. Fail closed until instant attribution is supported.
    if (principal.agentId) {
      const [assignment] = await tx.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id, principal.agentId)).limit(1)
      if (assignment) throw new InstantError('INSTANT_ORGANIZATION_UNSUPPORTED')
    }
    const terms = contract({ contract_json: JSON.stringify({ version: 1, seller_id: service.seller_id, capabilities: JSON.parse(service.capabilities),
      input_schema: JSON.parse(service.input_schema), output_schema: JSON.parse(service.output_schema), unit_price_minor: service.unit_price_minor,
      deadline_seconds: service.deadline_seconds, max_concurrency: service.max_concurrency, acceptance: 'schema_v1' }) } as Session)
    const loaded = await loadBuyerSpendPolicy(principal.userId, tx)
    if (loaded?.policy.provider_requirements && Object.keys(loaded.policy.provider_requirements).length) throw new InstantError('INSTANT_PROVIDER_REQUIREMENTS_UNSUPPORTED')
    const context = { sellerId: service.seller_id, capabilities: terms.capabilities, paymentRail: 'credit' as const, verificationMethods: ['schema'] }
    if (principal.agentId) await enforceAgentSpendPolicy(tx, { agentId: principal.agentId, buyerId: principal.userId, totalCost: input.budget_minor / 100, ...context })
    else await enforceBuyerSpendPolicy(tx, principal.userId, { totalMinor: input.budget_minor, ...context })
    const now = new Date(Math.floor(Date.now() / 1000) * 1000), id = crypto.randomUUID()
    await changeCredit(tx, principal.userId, id, 'instant_funding', -input.budget_minor, 0)
    const [session] = await tx.insert(instant_sessions).values({ id, buyer_id: principal.userId, service_id: serviceId, client_reference: input.client_reference,
      budget_minor: input.budget_minor, balance_minor: input.budget_minor, contract_json: JSON.stringify(terms), created_at: now,
      expires_at: new Date(now.getTime() + input.expires_in_seconds * 1000) }).returning()
    return { session: instantSessionDto(session), idempotent: false }
  })
}
async function sessionRow(tx: Tx, id: string) {
  const [row] = await tx.select().from(instant_sessions).where(eq(instant_sessions.id, id)).limit(1)
  if (!row) throw new InstantError('INSTANT_SESSION_NOT_FOUND', 404)
  return row
}
async function callRow(tx: Tx, id: string) {
  const [row] = await tx.select().from(instant_calls).where(eq(instant_calls.id, id)).limit(1)
  if (!row) throw new InstantError('INSTANT_CALL_NOT_FOUND', 404)
  return row
}
async function failCall(tx: Tx, call: Call, code: string) {
  const [failed] = await tx.update(instant_calls).set({ state: 'failed', failure_code: code, completed_at: new Date() })
    .where(and(eq(instant_calls.id, call.id), inArray(instant_calls.state, [...states]))).returning()
  if (failed) await tx.update(instant_sessions).set({ held_minor: sql`${instant_sessions.held_minor} - ${call.unit_price_minor}` }).where(eq(instant_sessions.id, call.session_id))
  return failed || call
}
async function finalizeSession(tx: Tx, id: string) {
  let session = await sessionRow(tx, id)
  if (session.status === 'closed') return session
  if (session.status === 'open' && session.expires_at.getTime() > Date.now()) return session
  const abandoned = await tx.select().from(instant_calls).where(and(eq(instant_calls.session_id, id), inArray(instant_calls.state, [...states]),
    sql`(${instant_calls.deadline_at} <= ${Math.floor(Date.now()/1000)} OR ${instant_calls.state} = 'pending')`)).limit(1000)
  for (const call of abandoned) await failCall(tx, call, call.deadline_at.getTime() <= Date.now() ? 'CALL_DEADLINE_EXCEEDED' : 'SESSION_CLOSED')
  session = await sessionRow(tx, id)
  if (session.held_minor > 0) {
    const [closing] = await tx.update(instant_sessions).set({ status: 'closing' }).where(eq(instant_sessions.id, id)).returning()
    return closing
  }
  if (session.balance_minor) await changeCredit(tx, session.buyer_id, id, 'instant_refund', session.balance_minor, 0)
  const [closed] = await tx.update(instant_sessions).set({ status: 'closed', balance_minor: 0,
    refunded_minor: sql`${instant_sessions.refunded_minor} + ${session.balance_minor}`, closed_at: new Date() }).where(eq(instant_sessions.id, id)).returning()
  return closed
}
async function expireCalls(tx: Tx, sessionId: string) {
  const expired = await tx.select().from(instant_calls).where(and(eq(instant_calls.session_id, sessionId), inArray(instant_calls.state, [...states]), lte(instant_calls.deadline_at, new Date()))).limit(1000)
  for (const call of expired) await failCall(tx, call, 'CALL_DEADLINE_EXCEEDED')
  await finalizeSession(tx, sessionId)
}
export async function readInstantSession(buyerId: string, id: string, close = false) {
  return write(async tx => {
    const session = await sessionRow(tx, id)
    if (session.buyer_id !== buyerId) throw new InstantError('INSTANT_SESSION_NOT_FOUND', 404)
    if (close && session.status === 'open') await tx.update(instant_sessions).set({ status: 'closing' }).where(eq(instant_sessions.id, id))
    await expireCalls(tx, id)
    return instantSessionDto(await sessionRow(tx, id))
  })
}
export async function createInstantCall(principal: RequestPrincipal, id: string, input: z.output<typeof instantCallInput>) {
  return write(async tx => {
    const session = await sessionRow(tx, id)
    if (session.buyer_id !== principal.userId) throw new InstantError('INSTANT_SESSION_NOT_FOUND', 404)
    const inputJson = canonicalContract(input.input), inputHash = hash(inputJson)
    const [prior] = await tx.select().from(instant_calls).where(and(eq(instant_calls.session_id, id), eq(instant_calls.client_reference, input.client_reference))).limit(1)
    if (prior) {
      if (prior.input_hash !== inputHash) throw new InstantError('IDEMPOTENCY_CONFLICT')
      await expireCalls(tx, id)
      return { call: instantCallDto(await callRow(tx, prior.id)), idempotent: true }
    }
    await newAuthority(tx)
    if (session.status !== 'open' || session.expires_at.getTime() <= Date.now()) throw new InstantError('INSTANT_SESSION_CLOSED')
    const terms = contract(session)
    if (await referenceFleetPaidServicePublicationLocked(terms.seller_id.startsWith('user_agent_') ? terms.seller_id.slice('user_agent_'.length) : null)) throw new InstantError('REFERENCE_FLEET_PAID_SERVICES_LOCKED')
    if (!await isPublicMarketplaceSeller(terms.seller_id)) throw new InstantError('SELLER_NOT_PUBLIC')
    if (checkServiceInput(input.input, terms.input_schema).status !== 'valid') throw new InstantError('INSTANT_INPUT_INVALID', 422)
    const loaded = await loadBuyerSpendPolicy(principal.userId, tx)
    if (loaded) {
      const reason = checkBuyerPolicyConstraints(loaded.policy, { totalMinor: terms.unit_price_minor, sellerId: terms.seller_id,
        capabilities: terms.capabilities, paymentRail: 'credit', verificationMethods: ['schema'] })
      if (reason) throw new BuyerSpendPolicyError(reason, 'Buyer policy blocks this instant call')
      const usage = await buyerPolicyUsage(principal.userId, new Date(), tx)
      if (loaded.policy.max_daily !== undefined && usage.reserved_or_spent_today_minor > loaded.policy.max_daily) throw new BuyerSpendPolicyError('BUYER_DAILY_LIMIT', 'Daily limit exceeded')
      if (loaded.policy.max_monthly !== undefined && usage.reserved_or_spent_month_minor > loaded.policy.max_monthly) throw new BuyerSpendPolicyError('BUYER_MONTHLY_LIMIT', 'Monthly limit exceeded')
      if (loaded.policy.provider_requirements && Object.keys(loaded.policy.provider_requirements).length) throw new InstantError('INSTANT_PROVIDER_REQUIREMENTS_UNSUPPORTED')
    }
    if (principal.agentId) {
      const [assignment] = await tx.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id, principal.agentId)).limit(1)
      if (assignment) throw new InstantError('INSTANT_ORGANIZATION_UNSUPPORTED')
      const snapshot = await getAgentSpendSnapshot(principal.agentId, principal.userId, new Date(), tx)
      if (terms.unit_price_minor / 100 > snapshot.per_trade_limit || snapshot.reserved_or_spent_today > snapshot.daily_limit) throw new InstantError('AGENT_SPEND_LIMIT')
    }
    // Expired calls do not consume concurrency. Their held budget is released by reconciliation/read.
    const [capacity] = await tx.select({ count: sql<number>`COUNT(*)` }).from(instant_calls).where(and(eq(instant_calls.service_id, session.service_id),
      inArray(instant_calls.state, [...states]), sql`${instant_calls.deadline_at} > ${Math.floor(Date.now()/1000)}`))
    const [service] = await tx.select().from(instant_services).where(eq(instant_services.id, session.service_id)).limit(1)
    if (!service || service.status !== 'active') throw new InstantError('INSTANT_SERVICE_UNAVAILABLE')
    if (Number(capacity.count) >= Math.min(service.max_concurrency, terms.max_concurrency)) throw new InstantError('CAPACITY_FULL')
    if (session.balance_minor - session.held_minor < terms.unit_price_minor) throw new InstantError('SESSION_BUDGET_EXHAUSTED', 402)
    const [count] = await tx.select({ count: sql<number>`COUNT(*)` }).from(instant_calls).where(eq(instant_calls.session_id, id))
    if (Number(count.count) >= 1000) throw new InstantError('SESSION_CALL_LIMIT')
    await tx.update(instant_sessions).set({ held_minor: sql`${instant_sessions.held_minor} + ${terms.unit_price_minor}` }).where(eq(instant_sessions.id, id))
    const [call] = await tx.insert(instant_calls).values({ session_id: id, service_id: session.service_id, seller_id: terms.seller_id,
      client_reference: input.client_reference, input_json: inputJson, input_hash: inputHash, unit_price_minor: terms.unit_price_minor,
      deadline_at: new Date(Math.min(session.expires_at.getTime(), Math.floor(Date.now()/1000)*1000 + terms.deadline_seconds*1000)) }).returning()
    return { call: instantCallDto(call), idempotent: false }
  })
}
export async function readInstantCall(userId: string, id: string) {
  return write(async tx => {
    let call = await callRow(tx, id)
    const session = await sessionRow(tx, call.session_id)
    if (userId !== session.buyer_id && userId !== call.seller_id) throw new InstantError('INSTANT_CALL_NOT_FOUND', 404)
    await expireCalls(tx, session.id); call = await callRow(tx, id)
    return instantCallDto(call)
  })
}
function validLease(call: Call, token: string) {
  const expected = call.lease_token_hash
  return expected !== null && /^[0-9a-f]{64}$/.test(expected) && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hash(token), 'hex'))
}
export async function claimInstantCall(sellerId: string, id: string, token: string) {
  return write(async tx => {
    let call = await callRow(tx, id)
    if (call.seller_id !== sellerId) throw new InstantError('INSTANT_CALL_NOT_FOUND', 404)
    await expireCalls(tx, call.session_id); call = await callRow(tx, id)
    if (call.state === 'failed') return instantCallDto(call)
    if (call.state !== 'pending') {
      if (!validLease(call, token)) throw new InstantError('LEASE_CONFLICT')
      return instantCallDto(call)
    }
    const [claimed] = await tx.update(instant_calls).set({ state: 'claimed', lease_token_hash: hash(token) }).where(and(eq(instant_calls.id, id), eq(instant_calls.state, 'pending'))).returning()
    if (!claimed) throw new InstantError('LEASE_CONFLICT')
    return instantCallDto(claimed)
  })
}
export async function completeInstantCall(sellerId: string, id: string, result: z.output<typeof instantResultInput>) {
  return write(async tx => {
    let call = await callRow(tx, id)
    if (call.seller_id !== sellerId) throw new InstantError('INSTANT_CALL_NOT_FOUND', 404)
    if (!validLease(call, result.lease_token)) throw new InstantError('LEASE_REJECTED', 403)
    if (call.state === 'completed') {
      if (result.outcome !== 'completed' || canonicalContract(result.output) !== call.output_json) throw new InstantError('IDEMPOTENCY_CONFLICT')
      return { call: instantCallDto(call), idempotent: true }
    }
    await expireCalls(tx, call.session_id); call = await callRow(tx, id)
    if (call.state === 'failed') return { call: instantCallDto(call), idempotent: true }
    if (call.state !== 'claimed') throw new InstantError('LEASE_REJECTED', 403)
    if (result.outcome === 'failed') {
      call = await failCall(tx, call, 'PROVIDER_FAILED'); await finalizeSession(tx, call.session_id)
      return { call: instantCallDto(call), idempotent: false }
    }
    const session = await sessionRow(tx, call.session_id), terms = contract(session)
    if (verifyOutputSchema(result.output, terms.output_schema).status !== 'passed') throw new InstantError('INSTANT_OUTPUT_INVALID', 422)
    const outputJson = canonicalContract(result.output), now = new Date()
    const receipt = { version: 1, id: call.id, call_id: call.id, session_id: session.id, service_id: session.service_id,
      buyer_id: session.buyer_id, seller_id: call.seller_id, units: 1, amount_minor: call.unit_price_minor,
      currency: 'USD', payment_rail: 'credit', metering: 'one_successful_call', verification: 'schema_v1',
      input_sha256: call.input_hash, output_sha256: hash(outputJson), settled_at: now.toISOString() }
    await changeCredit(tx, call.seller_id, call.id, 'instant_sale', call.unit_price_minor, 0)
    await tx.update(instant_sessions).set({ held_minor: sql`${instant_sessions.held_minor} - ${call.unit_price_minor}`,
      balance_minor: sql`${instant_sessions.balance_minor} - ${call.unit_price_minor}`,
      spent_minor: sql`${instant_sessions.spent_minor} + ${call.unit_price_minor}` }).where(eq(instant_sessions.id, session.id))
    const [completed] = await tx.update(instant_calls).set({ state: 'completed', output_json: outputJson, receipt_json: JSON.stringify(receipt), completed_at: now }).where(and(eq(instant_calls.id, id), eq(instant_calls.state, 'claimed'))).returning()
    if (!completed) throw new InstantError('CALL_STATE_CHANGED')
    await finalizeSession(tx, session.id)
    return { call: instantCallDto(completed), idempotent: false }
  })
}
export async function listInstantProviderCalls(sellerId: string) {
  const rows = await db.select().from(instant_calls).where(and(eq(instant_calls.seller_id, sellerId), inArray(instant_calls.state, [...states]), sql`${instant_calls.deadline_at} > ${Math.floor(Date.now()/1000)}`)).limit(100)
  // Inputs are available only after a worker has claimed the call.
  return rows.map(({ input_json: _input, lease_token_hash: _secret, output_json: _output, receipt_json: _receipt, ...call }) => call)
}
export async function reconcileInstantSessions(limit = 100) {
  return write(async tx => {
    const expired = await tx.select().from(instant_calls).where(and(inArray(instant_calls.state, [...states]), lte(instant_calls.deadline_at, new Date()))).limit(limit)
    for (const call of expired) { await failCall(tx, call, 'CALL_DEADLINE_EXCEEDED'); await finalizeSession(tx, call.session_id) }
    const sessions = await tx.select().from(instant_sessions).where(and(sql`${instant_sessions.status} != 'closed'`,
      sql`(${instant_sessions.status} = 'closing' OR ${instant_sessions.expires_at} <= ${Math.floor(Date.now()/1000)})`)).limit(limit)
    for (const session of sessions) await finalizeSession(tx, session.id)
    return { expired_calls: expired.length, reconciled_sessions: sessions.length }
  })
}
