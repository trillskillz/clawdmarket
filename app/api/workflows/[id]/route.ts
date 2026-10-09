import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { workflow_nodes, workflows, workflow_runs } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { workflowDto } from '@/lib/workflow-planning'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state: 'no_funds_moved' }, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function owned(id: string, buyerId: string) {
  return (await db.select().from(workflows).where(and(eq(workflows.id, id), eq(workflows.buyer_id, buyerId))).limit(1))[0]
}

async function response(workflow: typeof workflows.$inferSelect, idempotent?: boolean) {
  const nodes = await db.select().from(workflow_nodes).where(eq(workflow_nodes.workflow_id, workflow.id))
  const [run] = await db.select({ id: workflow_runs.id }).from(workflow_runs).where(eq(workflow_runs.workflow_id, workflow.id)).limit(1)
  return NextResponse.json({ workflow: workflowDto(workflow, nodes), funds_moved: false,
    funds_state: run ? 'recover_original_children' : 'no_funds_moved', ...(idempotent === undefined ? {} : { idempotent }) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
    const workflow = await owned((await params).id, principal.userId)
    return workflow ? response(workflow) : failure('WORKFLOW_NOT_FOUND', 'Workflow not found', 404)
  } catch (error) { return internalErrorResponse('Workflow inspection failed', error) }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
    if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
    const id = (await params).id
    const [cancelled] = await db.update(workflows).set({ state: 'cancelled', updated_at: new Date() })
      .where(and(eq(workflows.id, id), eq(workflows.buyer_id, principal.userId), eq(workflows.state, 'planned'))).returning()
    if (cancelled) return response(cancelled, false)
    const prior = await owned(id, principal.userId)
    return prior ? response(prior, true) : failure('WORKFLOW_NOT_FOUND', 'Workflow not found', 404)
  } catch (error) { return internalErrorResponse('Workflow cancellation failed', error) }
}
