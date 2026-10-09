import { NextResponse } from 'next/server'
import { ArtifactError, privateArtifactHeaders } from './private-artifacts'
import { RouteMandateError } from './route-payment-mandate'
import { WorkflowApprovalError, WorkflowPlanError } from './workflow-approval'
import { internalErrorResponse } from './api-error'

export const workflowReply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: privateArtifactHeaders })
export function workflowHttpError(error: unknown) {
  if (error instanceof RouteMandateError || error instanceof ArtifactError || error instanceof WorkflowApprovalError) return workflowReply({ error_code: error.code,
    retryable: error.status === 503, funds_state: 'recover_original_children', funds_moved: false }, error.status)
  if (error instanceof WorkflowPlanError) return workflowReply({ error_code: error.code, funds_moved: false }, 409)
  const response = internalErrorResponse('Workflow execution request failed', error)
  for (const [name, value] of Object.entries(privateArtifactHeaders)) response.headers.set(name, value)
  return response
}
