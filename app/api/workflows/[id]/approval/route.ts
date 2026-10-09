import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { approveWorkflow, inspectWorkflowApproval, revokeWorkflowApproval, WorkflowApprovalError, WorkflowPlanError } from '@/lib/workflow-approval'
import { RouteMandateError } from '@/lib/route-payment-mandate'
import { ArtifactError, privateArtifactHeaders, readBoundedJson } from '@/lib/private-artifacts'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: privateArtifactHeaders })
async function handle(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    if (request.method === 'GET') {
      const principal = await resolveRequestPrincipal(request)
      if (!principal) return reply({ error_code: 'UNAUTHORIZED' }, 401)
      return reply(await inspectWorkflowApproval(id, principal.userId))
    }
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return reply({ error_code: 'OWNER_ACCOUNT_REQUIRED' }, 401)
    if (owner.usesCookieAuth && !validateCsrf(request)) return reply({ error_code: 'CSRF_FAILED' }, 403)
    if (request.method === 'DELETE') return reply(await revokeWorkflowApproval(id, owner.userId))
    const result = await approveWorkflow(id, owner.userId, await readBoundedJson(request, 196_608))
    return reply(result, result.idempotent ? 200 : 201)
  } catch (error) {
    if (error instanceof WorkflowApprovalError || error instanceof RouteMandateError || error instanceof ArtifactError) {
      return reply({ error_code: error.code, retryable: error.status === 503, funds_state: 'no_new_funds_moved', execution_available: false, spending_authority: false }, error.status)
    }
    if (error instanceof WorkflowPlanError) return reply({ error_code: error.code, execution_available: false, spending_authority: false }, 409)
    return internalErrorResponse('Workflow approval request failed', error)
  }
}
export const GET = handle
export const POST = handle
export const DELETE = handle
