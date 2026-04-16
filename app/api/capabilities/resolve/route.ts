import { NextRequest, NextResponse } from 'next/server'
import { CAPABILITIES, canonicalize, resolveCapabilities, resolveCapabilityQuery } from '@/lib/capabilities'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') || ''
  const raw = request.nextUrl.searchParams.get('capabilities') || ''
  const inputs = [
    ...raw.split(','),
    q,
  ]
    .map((value) => value.trim())
    .filter(Boolean)

  const queryMatches = q ? resolveCapabilityQuery(q) : []
  const resolved = resolveCapabilities([...inputs, ...queryMatches])
  const canonicalIds = [...new Set([
    ...resolved.matches.map((match) => match.canonical_id),
    ...queryMatches,
  ])]

  return NextResponse.json({
    query: q,
    normalized_query: canonicalize(q),
    canonical_ids: canonicalIds,
    matches: canonicalIds
      .map((id) => CAPABILITIES.find((capability) => capability.id === id))
      .filter(Boolean),
    unknown: resolved.unknown,
  }, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
