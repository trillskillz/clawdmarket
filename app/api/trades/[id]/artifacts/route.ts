import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { internalErrorResponse } from '@/lib/api-error'
import { ArtifactError, ARTIFACT_LIMITS, listPrivateArtifacts, privateArtifactHeaders, readBoundedJson, uploadPrivateArtifact } from '@/lib/private-artifacts'

export const dynamic = 'force-dynamic'
async function handle(request: NextRequest, params: Promise<{ id: string }>, upload: boolean) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return NextResponse.json({ error_code: 'UNAUTHORIZED' }, { status: 401, headers: privateArtifactHeaders })
    if (upload && principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error_code: 'CSRF_FAILED' }, { status: 403, headers: privateArtifactHeaders })
    const { id } = await params
    if (!upload) return NextResponse.json({ artifacts: await listPrivateArtifacts(id, principal.userId), limits: ARTIFACT_LIMITS }, { headers: privateArtifactHeaders })
    const result = await uploadPrivateArtifact(id, principal.userId, await readBoundedJson(request, ARTIFACT_LIMITS.request_bytes))
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201, headers: privateArtifactHeaders })
  } catch (error) {
    if (error instanceof ArtifactError) return NextResponse.json({ error_code: error.code, retryable: error.code === 'ARTIFACT_STORAGE_BUSY' }, { status: error.status, headers: privateArtifactHeaders })
    return internalErrorResponse('Private artifact request failed', error)
  }
}
export function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { return handle(request, params, false) }
export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { return handle(request, params, true) }
