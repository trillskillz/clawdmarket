import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { internalErrorResponse } from '@/lib/api-error'
import { ArtifactError, downloadPrivateArtifact, privateArtifactHeaders } from '@/lib/private-artifacts'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return NextResponse.json({ error_code: 'UNAUTHORIZED' }, { status: 401, headers: privateArtifactHeaders })
    const { id, artifactId } = await params
    const { metadata, bytes } = await downloadPrivateArtifact(id, artifactId, principal.userId)
    return new Response(new Uint8Array(bytes), { headers: { ...privateArtifactHeaders,
      'Content-Type': metadata.media_type, 'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${metadata.name}"`,
      'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Artifact-SHA256': metadata.sha256 } })
  } catch (error) {
    if (error instanceof ArtifactError) return NextResponse.json({ error_code: error.code, retryable: false }, { status: error.status, headers: privateArtifactHeaders })
    return internalErrorResponse('Private artifact retrieval failed', error)
  }
}
