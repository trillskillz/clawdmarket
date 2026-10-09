import { NextRequest } from 'next/server'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { readBoundedJson } from '@/lib/private-artifacts'
import { activateWorkflow } from '@/lib/workflow-execution-budget'
import { inspectWorkflowRun } from '@/lib/workflow-reconciliation'
import { workflowReply, workflowHttpError } from '@/lib/workflow-execution-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: NextRequest, context: Context) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return workflowReply({ error_code: 'UNAUTHORIZED' }, 401)
    return workflowReply(await inspectWorkflowRun((await context.params).id, principal.userId))
  } catch (error) { return workflowHttpError(error) }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return workflowReply({ error_code: 'OWNER_ACCOUNT_REQUIRED' }, 401)
    if (owner.usesCookieAuth && !validateCsrf(request)) return workflowReply({ error_code: 'CSRF_FAILED' }, 403)
    const result = await activateWorkflow((await context.params).id, owner.userId, await readBoundedJson(request, 2048))
    return workflowReply({ ...result, funds_moved: false, production_execution_available: false }, result.idempotent ? 200 : 201)
  } catch (error) { return workflowHttpError(error) }
}
