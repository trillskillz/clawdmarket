import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organization_team_budgets } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { enterpriseMutationAccount, enterpriseFailure } from '@/lib/enterprise-api'
import { enterpriseFoundationEnabled } from '@/lib/enterprise-foundation'
import { organizationBudgetDto, organizationBudgetInput } from '@/lib/organization-budgets'
import { ownedBudgetTeam, updateTeamBudget, teamBudgetUsage, validateTeamBudget, TeamBudgetError } from '@/lib/organization-team-budgets'
import { readBoundedJson, ArtifactError } from '@/lib/private-artifacts'
import { rateLimit } from '@/lib/rate-limit'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
const privateHeaders = { 'Cache-Control': 'private, no-store' }
type Context = { params: Promise<{ id: string; teamId: string }> }
function failure(error: unknown) {
  if (error instanceof TeamBudgetError || error instanceof ArtifactError) {
    const response = enterpriseFailure(error.code, error.code, error.status)
    if (error.status === 503) return NextResponse.json({ success: false, error_code: error.code, retryable: true,
      state: 'no_funds_moved' }, { status: 503, headers: privateHeaders })
    return response
  }
  const response = internalErrorResponse('Team budget request failed', error)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return enterpriseFailure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    const { id, teamId } = await params
    if (!await ownedBudgetTeam(id, teamId, owner.userId)) return enterpriseFailure('TEAM_NOT_FOUND', 'Team not found', 404)
    const [budget] = await db.select().from(organization_team_budgets).where(eq(organization_team_budgets.team_id, teamId)).limit(1)
    if (budget) validateTeamBudget(budget, id)
    const usage = await teamBudgetUsage(id, teamId)
    return NextResponse.json({ organization_id: id, team_id: teamId, budget: budget ? organizationBudgetDto(budget) : null,
      version: budget?.version || 0, usage: {
        reserved_or_spent_today: (usage.reserved_or_spent_today_minor / 100).toFixed(2),
        reserved_or_spent_month: (usage.reserved_or_spent_month_minor / 100).toFixed(2),
        remaining_daily: budget?.max_daily_minor == null ? null : (Math.max(0, budget.max_daily_minor - usage.reserved_or_spent_today_minor) / 100).toFixed(2),
        remaining_monthly: budget?.max_monthly_minor == null ? null : (Math.max(0, budget.max_monthly_minor - usage.reserved_or_spent_month_minor) / 100).toFixed(2),
      } }, { headers: privateHeaders })
  } catch (error) { return failure(error) }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const { account, error } = await enterpriseMutationAccount(request)
    if (error || !account) return error
    const parsed = organizationBudgetInput.safeParse(await readBoundedJson(request, 2048))
    if (!parsed.success) return enterpriseFailure('INVALID_TEAM_BUDGET', 'Budget request is invalid', 400)
    if (!enterpriseFoundationEnabled()) return enterpriseFailure('ENTERPRISE_FOUNDATION_DISABLED', 'Team budget writes are disabled', 503)
    const limit = await rateLimit(`team-budget:${account.userId}`, { interval: 86_400_000, maxRequests: 50, failClosed: true })
    if (!limit.success) return enterpriseFailure('ORGANIZATION_RATE_LIMIT', 'Budget update rate limit reached', 429)
    const { id, teamId } = await params
    const result = await updateTeamBudget(id, teamId, account.userId, parsed.data)
    return NextResponse.json({ organization_id: id, team_id: teamId, budget: organizationBudgetDto(result.row),
      idempotent: result.idempotent }, { headers: privateHeaders })
  } catch (error) { return failure(error) }
}
