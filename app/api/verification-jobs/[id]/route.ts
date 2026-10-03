import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { ArtifactError, privateArtifactHeaders, readBoundedJson } from '@/lib/private-artifacts'
import { cancelVerificationJob, getVerificationJob, submitVerificationReport, VerificationJobError } from '@/lib/verification-jobs'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
async function handle(request: NextRequest, params: Promise<{ id: string }>, action: 'get' | 'report' | 'cancel') {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return NextResponse.json({ error_code: 'UNAUTHORIZED' }, { status: 401, headers: privateArtifactHeaders })
    if (action !== 'get' && principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error_code: 'CSRF_FAILED' }, { status: 403, headers: privateArtifactHeaders })
    const { id } = await params
    const result = action === 'get' ? await getVerificationJob(id, principal.userId) : action === 'cancel' ? await cancelVerificationJob(id, principal.userId)
      : await submitVerificationReport(id, principal.userId, await readBoundedJson(request, 8192))
    return NextResponse.json(result, { headers: privateArtifactHeaders })
  } catch (error) {
    if (error instanceof VerificationJobError || error instanceof ArtifactError) return NextResponse.json({ error_code: error.code, retryable: error.code === 'VERIFICATION_STORAGE_BUSY' }, { status: error.status, headers: privateArtifactHeaders })
    return internalErrorResponse('Verification job action failed', error)
  }
}
export function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { return handle(request, params, 'get') }
export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { return handle(request, params, 'report') }
export function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { return handle(request, params, 'cancel') }
