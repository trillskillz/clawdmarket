import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { ArtifactError, privateArtifactHeaders } from '@/lib/private-artifacts'
import { downloadWorkflowArtifact } from '@/lib/workflow-artifact-grants'
import { RouteMandateError } from '@/lib/route-payment-mandate'
import { WorkflowApprovalError } from '@/lib/workflow-approval'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; grantId: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return NextResponse.json({ error_code: 'UNAUTHORIZED' }, { status: 401, headers: privateArtifactHeaders })
    const { id, grantId } = await params
    const { metadata, bytes } = await downloadWorkflowArtifact(id, grantId, principal.userId)
    return new Response(new Uint8Array(bytes), { headers: { ...privateArtifactHeaders,
      'Content-Type': metadata.media_type, 'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${metadata.name}"`,
      'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Artifact-SHA256': metadata.sha256 } })
  } catch (error) {
    if (error instanceof ArtifactError || error instanceof RouteMandateError || error instanceof WorkflowApprovalError) return NextResponse.json({ error_code: error.code,
      retryable: error.status === 503 }, { status: error.status, headers: privateArtifactHeaders })
    const response = internalErrorResponse('Workflow artifact retrieval failed', error)
    for (const [name, value] of Object.entries(privateArtifactHeaders)) response.headers.set(name, value)
    return response
  }
}
