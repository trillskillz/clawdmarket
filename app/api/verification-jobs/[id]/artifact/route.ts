import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { ArtifactError, privateArtifactHeaders } from '@/lib/private-artifacts'
import { downloadVerificationArtifact, VerificationJobError } from '@/lib/verification-jobs'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return NextResponse.json({ error_code: 'UNAUTHORIZED' }, { status: 401, headers: privateArtifactHeaders })
    const { id } = await params
    const result = await downloadVerificationArtifact(id, principal.userId)
    return new NextResponse(new Uint8Array(result.bytes), { headers: { ...privateArtifactHeaders, 'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="input.mjs"', 'Content-Security-Policy': "sandbox; default-src 'none'",
      'Content-Length': String(result.bytes.length), 'X-Artifact-SHA256': result.artifact.sha256 } })
  } catch (error) {
    if (error instanceof VerificationJobError || error instanceof ArtifactError) return NextResponse.json({ error_code: error.code }, { status: error.status, headers: privateArtifactHeaders })
    return internalErrorResponse('Verification artifact request failed', error)
  }
}
