import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { buyer_spend_policies, buyer_spend_policy_events } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { accountOwnsAgent, resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { validateCsrf } from '@/lib/csrf'
import { buyerPolicyUsage, buyerSpendPolicyInput, loadBuyerSpendPolicy, policyToPublic } from '@/lib/buyer-spend-policy'
import { getAgentSpendLimits } from '@/lib/agent-spend-policy'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { internalErrorResponse } from '@/lib/api-error'
import { withKeyedWriteLock } from '@/lib/service-reservation-lock'

export const dynamic = 'force-dynamic'

const updateInput = z.object({ agent_id: z.string().min(1).max(200), expected_version: z.number().int().min(0), policy: buyerSpendPolicyInput }).strict()
function failure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state: 'no_funds_moved' }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}
function sqliteBusy(error: unknown) {
  let current = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'message' in current && /SQLITE_BUSY|database is locked/i.test(String(current.message))) return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

export async function GET(request: NextRequest) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
  const agentId = request.nextUrl.searchParams.get('agent_id')
  const buyerId = agentId ? `user_agent_${agentId}` : principal.userId
  if (buyerId !== principal.userId) {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner || !agentId || !await accountOwnsAgent(owner.userId, agentId)) return failure('SPENDING_POLICY_NOT_FOUND', 'Policy not found', 404)
  }
  try {
    const loaded = await loadBuyerSpendPolicy(buyerId)
    const usage = await buyerPolicyUsage(buyerId)
    return NextResponse.json({ buyer_id: buyerId, version: loaded?.row.version || 0,
      policy: loaded ? policyToPublic(loaded.policy) : null,
      deployment_ceiling: getAgentSpendLimits(),
      usage: { reserved_or_spent_today: (usage.reserved_or_spent_today_minor / 100).toFixed(2),
        reserved_or_spent_month: (usage.reserved_or_spent_month_minor / 100).toFixed(2),
        remaining_daily: loaded?.policy.max_daily === undefined ? null : (Math.max(0, loaded.policy.max_daily - usage.reserved_or_spent_today_minor) / 100).toFixed(2),
        remaining_monthly: loaded?.policy.max_monthly === undefined ? null : (Math.max(0, loaded.policy.max_monthly - usage.reserved_or_spent_month_minor) / 100).toFixed(2) } },
    { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Spending policy lookup failed', error) }
}

export async function PUT(request: NextRequest) {
  const owner = await resolveAuthenticatedOwnerAccount(request)
  if (!owner) return failure('OWNER_ACCOUNT_REQUIRED', 'Linked owner account required', 401)
  if (owner.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
  const parsed = updateInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ success: false, error_code: 'INVALID_SPENDING_POLICY', message: 'Invalid policy', retryable: false, details: parsed.error.issues }, { status: 400 })
  const { agent_id, expected_version, policy } = parsed.data
  if (!await accountOwnsAgent(owner.userId, agent_id)) return failure('SPENDING_POLICY_NOT_FOUND', 'Policy not found', 404)
  const limit = await rateLimit(`spending-policy:${owner.userId}:${agent_id}`, { interval: 86_400_000, maxRequests: 30, failClosed: true })
  if (!limit.success) return failure('SPENDING_POLICY_RATE_LIMIT', 'Policy update rate limit reached', 429)
  const buyerId = `user_agent_${agent_id}`
  const serialized = JSON.stringify(policy)
  try {
    const write = () => withKeyedWriteLock(`spending-policy:${buyerId}`, () => db.transaction(async (tx) => {
      const [current] = await tx.select().from(buyer_spend_policies).where(eq(buyer_spend_policies.buyer_id, buyerId)).limit(1)
      if (current?.policy_json === serialized) return { version: current.version, changed: false }
      if ((current?.version || 0) !== expected_version) return null
      const now = new Date()
      const version = expected_version + 1
      if (current) {
        const [updated] = await tx.update(buyer_spend_policies).set({ owner_account_id: owner.userId, policy_json: serialized, version, updated_at: now })
          .where(and(eq(buyer_spend_policies.buyer_id, buyerId), eq(buyer_spend_policies.version, expected_version))).returning()
        if (!updated) return null
      } else {
        await tx.insert(buyer_spend_policies).values({ buyer_id: buyerId, owner_account_id: owner.userId, policy_json: serialized, version, created_at: now, updated_at: now })
      }
      await tx.insert(buyer_spend_policy_events).values({ id: crypto.randomUUID(), buyer_id: buyerId, actor_account_id: owner.userId,
        version, old_policy_json: current?.policy_json || null, new_policy_json: serialized, created_at: now })
      return { version, changed: true }
    }))
    let result: Awaited<ReturnType<typeof write>> = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { result = await write(); break }
      catch (error) {
        if (!sqliteBusy(error) || attempt === 4) throw error
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
    if (!result) return failure('SPENDING_POLICY_VERSION_CONFLICT', 'Policy changed; fetch the current version', 409)
    return NextResponse.json({ buyer_id: buyerId, version: result.version, policy: policyToPublic(policy), idempotent: !result.changed },
      { headers: { ...getRateLimitHeaders(limit), 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const current = await loadBuyerSpendPolicy(buyerId).catch(() => null)
    if (current && current.row.version !== expected_version) return failure('SPENDING_POLICY_VERSION_CONFLICT', 'Policy changed; fetch the current version', 409)
    return internalErrorResponse('Spending policy update failed', error)
  }
}
