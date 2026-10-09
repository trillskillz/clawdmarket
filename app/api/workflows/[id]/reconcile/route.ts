import { NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { readBoundedJson } from '@/lib/private-artifacts'
import { inspectWorkflowRun, reconcileWorkflow } from '@/lib/workflow-reconciliation'
import { workflowReply, workflowHttpError } from '@/lib/workflow-execution-http'

export const dynamic = 'force-dynamic'
const command = z.object({ version: z.literal(1), run_id: z.uuid() }).strict()
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return workflowReply({ error_code: 'UNAUTHORIZED' }, 401)
    if (principal.usesCookieAuth && !validateCsrf(request)) return workflowReply({ error_code: 'CSRF_FAILED' }, 403)
    const parsed = command.safeParse(await readBoundedJson(request, 1024))
    if (!parsed.success) return workflowReply({ error_code: 'INVALID_WORKFLOW_RECONCILIATION' }, 400)
    const { id } = await context.params
    const prior = await inspectWorkflowRun(id, principal.userId)
    if (prior.run.id !== parsed.data.run_id) return workflowReply({ error_code: 'WORKFLOW_NOT_FOUND' }, 404)
    return workflowReply(await reconcileWorkflow(id, principal.userId))
  } catch (error) { return workflowHttpError(error) }
}
