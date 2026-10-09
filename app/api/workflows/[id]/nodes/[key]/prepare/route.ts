import { NextRequest } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { workflow_runs, route_plans, route_payment_mandates } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { readBoundedJson } from '@/lib/private-artifacts'
import { prepareWorkflowNode } from '@/lib/workflow-execution-budget'
import { routePlanDto } from '@/lib/route-planning'
import { mandateDto } from '@/lib/route-payment-mandate'
import { workflowReply, workflowHttpError } from '@/lib/workflow-execution-http'

export const dynamic = 'force-dynamic'
const body = z.object({ version: z.literal(1), run_id: z.uuid() }).strict()
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; key: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return workflowReply({ error_code: 'UNAUTHORIZED' }, 401)
    if (principal.usesCookieAuth && !validateCsrf(request)) return workflowReply({ error_code: 'CSRF_FAILED' }, 403)
    const parsed = body.safeParse(await readBoundedJson(request, 1024))
    if (!parsed.success) return workflowReply({ error_code: 'INVALID_WORKFLOW_NODE_REQUEST' }, 400)
    const { id, key } = await context.params
    const [run] = await db.select({ workflow_id: workflow_runs.workflow_id }).from(workflow_runs).where(eq(workflow_runs.id, parsed.data.run_id)).limit(1)
    if (!run || run.workflow_id !== id) return workflowReply({ error_code: 'WORKFLOW_NOT_FOUND' }, 404)
    const prepared = await prepareWorkflowNode(parsed.data.run_id, key, principal.userId)
    const [route] = await db.select().from(route_plans).where(eq(route_plans.id, prepared.node.route_id!)).limit(1)
    const [mandate] = await db.select().from(route_payment_mandates).where(eq(route_payment_mandates.id, prepared.node.mandate_id!)).limit(1)
    if (!route || !mandate) return workflowReply({ error_code: 'WORKFLOW_CHILD_NOT_FOUND' }, 409)
    return workflowReply({ ...prepared, route: routePlanDto(route), mandate: mandateDto(mandate), funds_moved: false }, prepared.idempotent ? 200 : 201)
  } catch (error) { return workflowHttpError(error) }
}
