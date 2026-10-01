import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organizations, organization_spend_budgets } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { enterpriseMutationAccount, enterpriseFailure } from '@/lib/enterprise-api'
import { enterpriseFoundationEnabled } from '@/lib/enterprise-foundation'
import { organizationBudgetDto, organizationBudgetInput, organizationBudgetUsage, updateOrganizationBudget } from '@/lib/organization-budgets'
import { rateLimit } from '@/lib/rate-limit'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
const privateHeaders = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return enterpriseFailure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    const id = (await params).id
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, id), eq(organizations.owner_account_id, owner.userId))).limit(1)
    if (!organization) return enterpriseFailure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    const [budget] = await db.select().from(organization_spend_budgets).where(eq(organization_spend_budgets.organization_id, id)).limit(1)
    const usage = await organizationBudgetUsage(id)
    return NextResponse.json({ budget: budget ? organizationBudgetDto(budget) : null, version: budget?.version || 0,
      usage: { reserved_or_spent_today: (usage.reserved_or_spent_today_minor / 100).toFixed(2),
        reserved_or_spent_month: (usage.reserved_or_spent_month_minor / 100).toFixed(2),
        remaining_daily: budget?.max_daily_minor == null ? null : (Math.max(0, budget.max_daily_minor - usage.reserved_or_spent_today_minor) / 100).toFixed(2),
        remaining_monthly: budget?.max_monthly_minor == null ? null : (Math.max(0, budget.max_monthly_minor - usage.reserved_or_spent_month_minor) / 100).toFixed(2) } },
    { headers: privateHeaders })
  } catch (error) { return internalErrorResponse('Organization budget lookup failed', error) }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { account, error } = await enterpriseMutationAccount(request)
    if (error || !account) return error
    const parsed = organizationBudgetInput.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return enterpriseFailure('INVALID_ORGANIZATION_BUDGET', 'Budget request is invalid', 400)
    if (!enterpriseFoundationEnabled()) return enterpriseFailure('ENTERPRISE_FOUNDATION_DISABLED', 'Organization budget writes are disabled', 503)
    const limit = await rateLimit(`organization-budget:${account.userId}`, { interval: 86_400_000, maxRequests: 50, failClosed: true })
    if (!limit.success) return enterpriseFailure('ORGANIZATION_RATE_LIMIT', 'Budget update rate limit reached', 429)
    const result = await updateOrganizationBudget((await params).id, account.userId, parsed.data)
    if (result.kind === 'not_found') return enterpriseFailure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    if (result.kind === 'version_conflict') return enterpriseFailure('ORGANIZATION_BUDGET_VERSION_CONFLICT', 'Budget changed; fetch the current version', 409)
    return NextResponse.json({ budget: organizationBudgetDto(result.row), idempotent: result.idempotent }, { headers: privateHeaders })
  } catch (error) { return internalErrorResponse('Organization budget update failed', error) }
}
