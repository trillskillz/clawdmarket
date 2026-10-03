import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { ArtifactError, privateArtifactHeaders, readBoundedJson } from '@/lib/private-artifacts'
import { createVerificationJob, VerificationJobError } from '@/lib/verification-jobs'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return NextResponse.json({ error_code: 'UNAUTHORIZED' }, { status: 401, headers: privateArtifactHeaders })
    if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error_code: 'CSRF_FAILED' }, { status: 403, headers: privateArtifactHeaders })
    const { id } = await params
    const result = await createVerificationJob(id, principal.userId, await readBoundedJson(request, 16_384))
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201, headers: privateArtifactHeaders })
  } catch (error) {
    if (error instanceof VerificationJobError || error instanceof ArtifactError) return NextResponse.json({ error_code: error.code, retryable: error.code === 'VERIFICATION_STORAGE_BUSY' }, { status: error.status, headers: privateArtifactHeaders })
    return internalErrorResponse('Verification job request failed', error)
  }
}
