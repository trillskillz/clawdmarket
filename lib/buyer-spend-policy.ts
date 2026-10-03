import { and, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { buyer_spend_policies, trades } from './schema'
import { normalizeCapability } from './capabilities'

import { providerRequirementsSchema, providerMatches } from './provider-requirements'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const cents = z.string().regex(/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$/).transform((value) => {
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
})
const canonicalCapability = z.string().min(1).max(80).transform((value, ctx) => {
  const id = normalizeCapability(value)
  if (!id) { ctx.addIssue({ code: 'custom', message: 'Unknown capability' }); return z.NEVER }
  return id
})

export const buyerSpendPolicyInput = z.object({
  provider_requirements: providerRequirementsSchema.optional(),
  max_per_execution: cents.optional(),
  max_daily: cents.optional(),
  max_monthly: cents.optional(),
  max_retry_budget: cents.optional(),
  approval_required_above: cents.optional(),
  allowed_capabilities: z.array(canonicalCapability).max(30).optional(),
  blocked_capabilities: z.array(canonicalCapability).max(30).optional(),
  approved_providers: z.array(z.string().min(1).max(200)).max(100).optional(),
  blocked_providers: z.array(z.string().min(1).max(200)).max(100).optional(),
  approved_payment_rails: z.array(z.enum(['ledger', 'mpp', 'evm'])).min(1).max(3).optional(),
  required_verification_methods: z.array(z.enum(['buyer_review', 'schema', 'source_urls', 'assertions', 'source_evidence'])).min(1).max(5).optional(),
}).strict().superRefine((value, ctx) => {
  for (const field of ['allowed_capabilities', 'blocked_capabilities', 'approved_providers', 'blocked_providers', 'approved_payment_rails', 'required_verification_methods'] as const) {
    const items = value[field]
    if (items && new Set(items).size !== items.length) ctx.addIssue({ code: 'custom', path: [field], message: 'Duplicate entries are not allowed' })
  }
})

export type BuyerSpendPolicy = z.output<typeof buyerSpendPolicyInput>
export type SpendContext = {
  totalMinor: number
  sellerId?: string
  capabilities?: string[]
  paymentRail?: 'ledger' | 'mpp' | 'evm'
  verificationMethods?: string[]
  retrySpendMinor?: number
}

export class BuyerSpendPolicyError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'BuyerSpendPolicyError' }
}

export function policyToPublic(policy: BuyerSpendPolicy) {
  const amount = (value: number | undefined) => value === undefined ? undefined : (value / 100).toFixed(2)
  return { ...policy,
    max_per_execution: amount(policy.max_per_execution), max_daily: amount(policy.max_daily),
    max_monthly: amount(policy.max_monthly), max_retry_budget: amount(policy.max_retry_budget),
    approval_required_above: amount(policy.approval_required_above),
  }
}

export async function loadBuyerSpendPolicy(buyerId: string, source: Transaction | typeof db = db) {
  const [row] = await source.select().from(buyer_spend_policies).where(eq(buyer_spend_policies.buyer_id, buyerId)).limit(1)
  return row ? { row, policy: buyerSpendPolicyInput.parse(policyToPublic(JSON.parse(row.policy_json) as BuyerSpendPolicy)) } : null
}


export function checkBuyerPolicyConstraints(policy: BuyerSpendPolicy, context: SpendContext): string | null {
  if (policy.max_per_execution !== undefined && context.totalMinor > policy.max_per_execution) return 'BUYER_PER_EXECUTION_LIMIT'
  if (policy.approval_required_above !== undefined && context.totalMinor > policy.approval_required_above) return 'BUYER_APPROVAL_REQUIRED'
  if (policy.max_retry_budget !== undefined && context.retrySpendMinor !== undefined && context.retrySpendMinor > policy.max_retry_budget) return 'BUYER_RETRY_BUDGET_EXCEEDED'
  if (policy.approved_payment_rails && (!context.paymentRail || !policy.approved_payment_rails.includes(context.paymentRail))) return 'BUYER_PAYMENT_RAIL_BLOCKED'
  if (policy.approved_providers && (!context.sellerId || !providerMatches(policy.approved_providers, context.sellerId))) return 'BUYER_PROVIDER_BLOCKED'
  if (policy.blocked_providers && context.sellerId && providerMatches(policy.blocked_providers, context.sellerId)) return 'BUYER_PROVIDER_BLOCKED'
  if (policy.allowed_capabilities && (!context.capabilities || !context.capabilities.every((item) => policy.allowed_capabilities!.includes(item)))) return 'BUYER_CAPABILITY_BLOCKED'
  if (policy.blocked_capabilities && context.capabilities?.some((item) => policy.blocked_capabilities!.includes(item))) return 'BUYER_CAPABILITY_BLOCKED'
  if (policy.required_verification_methods && (!context.verificationMethods || !policy.required_verification_methods.every((method) => context.verificationMethods!.includes(method)))) return 'BUYER_VERIFICATION_REQUIRED'
  return null
}

async function reservedMinorSince(source: Transaction | typeof db, buyerId: string, since: Date) {
  const [row] = await source.select({ total: sql<number>`COALESCE(SUM(CAST(ROUND((CASE WHEN ${trades.total_cost} > 0 THEN ${trades.total_cost} ELSE ${trades.amount} + ${trades.fee} END) * 100) AS INTEGER)), 0)` })
    .from(trades).where(and(eq(trades.buyer_id, buyerId), gte(trades.created_at, since),
      sql`(${trades.status} <> 'cancelled' OR (${trades.payment_rail} <> 'ledger' AND ${trades.payout_status} <> 'refunded'))`))
  return Number(row?.total || 0)
}

export async function buyerPolicyUsage(buyerId: string, now = new Date(), source: Transaction | typeof db = db) {
  const dailyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const monthlyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return { reserved_or_spent_today_minor: await reservedMinorSince(source, buyerId, dailyStart),
    reserved_or_spent_month_minor: await reservedMinorSince(source, buyerId, monthlyStart) }
}

export async function enforceBuyerSpendPolicy(tx: Transaction, buyerId: string, context: SpendContext, now = new Date()) {
  const loaded = await loadBuyerSpendPolicy(buyerId, tx)
  if (!loaded) return
  const reason = checkBuyerPolicyConstraints(loaded.policy, context)
  if (reason) throw new BuyerSpendPolicyError(reason, 'Buyer spending policy does not permit this reservation')
  const usage = await buyerPolicyUsage(buyerId, now, tx)
  if (loaded.policy.max_daily !== undefined && usage.reserved_or_spent_today_minor + context.totalMinor > loaded.policy.max_daily) {
    throw new BuyerSpendPolicyError('BUYER_DAILY_LIMIT', 'Buyer daily reservation limit would be exceeded')
  }
  if (loaded.policy.max_monthly !== undefined && usage.reserved_or_spent_month_minor + context.totalMinor > loaded.policy.max_monthly) {
    throw new BuyerSpendPolicyError('BUYER_MONTHLY_LIMIT', 'Buyer monthly reservation limit would be exceeded')
  }
}
