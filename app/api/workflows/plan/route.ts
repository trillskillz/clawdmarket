import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { workflow_nodes, workflows } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { workflowPlanningEnabled } from '@/lib/routing-feature-flags'
import { WorkflowPlanError, normalizeWorkflow, workflowDto, workflowPlanInput } from '@/lib/workflow-planning'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number, retryable = false) {
  return NextResponse.json({ success: false, error_code, message, retryable, state: 'no_funds_moved' }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
  if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
  const parsed = workflowPlanInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure('INVALID_WORKFLOW_REQUEST', 'Workflow request is invalid', 400)
  let normalized: ReturnType<typeof normalizeWorkflow>
  try { normalized = normalizeWorkflow(parsed.data) }
  catch (error) {
    if (error instanceof WorkflowPlanError) return failure(error.code, error.message, 400)
    throw error
  }
  const planJson = JSON.stringify(normalized)
  const existing = async () => (await db.select().from(workflows).where(eq(workflows.client_reference, parsed.data.client_reference)).limit(1))[0]
  const replay = async () => {
    const prior = await existing()
    if (!prior) return null
    if (prior.buyer_id !== principal.userId || prior.plan_json !== planJson) return failure('IDEMPOTENCY_CONFLICT', 'Reference belongs to a different workflow plan', 409)
    const nodes = await db.select().from(workflow_nodes).where(eq(workflow_nodes.workflow_id, prior.id))
    return NextResponse.json({ workflow: workflowDto(prior, nodes), idempotent: true }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const prior = await replay()
  if (prior) return prior
  if (!workflowPlanningEnabled()) return failure('WORKFLOW_PLANNING_DISABLED', 'Workflow planning is not enabled', 503, true)
  const limit = await rateLimit(`workflow-plan:${principal.userId}`, { interval: 60_000, maxRequests: 5, failClosed: true })
  if (!limit.success) return NextResponse.json({ success: false, error_code: 'WORKFLOW_PLAN_RATE_LIMIT', message: 'Workflow planning rate limit reached', retryable: true, state: 'no_funds_moved' }, { status: 429, headers: getRateLimitHeaders(limit) })
  try {
    const created = await db.transaction(async (tx) => {
      const now = new Date()
      const id = crypto.randomUUID()
      const [workflow] = await tx.insert(workflows).values({ id, buyer_id: principal.userId,
        client_reference: parsed.data.client_reference, objective: normalized.objective, plan_json: planJson,
        max_budget_minor: normalized.max_budget_minor, deadline_seconds: normalized.deadline_seconds,
        state: 'planned', created_at: now, updated_at: now }).returning()
      const nodes = await tx.insert(workflow_nodes).values(normalized.nodes.map((node) => ({
        id: crypto.randomUUID(), workflow_id: id, node_key: node.key, objective: node.objective,
        required_capabilities: JSON.stringify(node.required_capabilities), depends_on: JSON.stringify(node.depends_on),
        budget_minor: node.budget_minor, deadline_seconds: node.deadline_seconds, depth: node.depth,
        state: 'planned' as const, created_at: now,
      }))).returning()
      return workflowDto(workflow, nodes)
    })
    return NextResponse.json({ workflow: created, idempotent: false }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const raced = await replay()
    if (raced) return raced
    return internalErrorResponse('Workflow planning failed', error)
  }
}
