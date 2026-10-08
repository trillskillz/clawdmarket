import { NextRequest, NextResponse } from 'next/server'
import { CAPABILITIES, canonicalize, resolveCapabilities, resolveCapabilityQuery } from '@/lib/capabilities'
import { capabilityFamily, familyCapabilities } from '@/lib/capability-hierarchy'

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

  const queryMatches = q && !q.trim().toLowerCase().startsWith('family:') ? resolveCapabilityQuery(q) : []
  const families = [...new Map(inputs.map(capabilityFamily).filter((family) => family !== null).map((family) => [family.id, family])).values()]
  const resolved = resolveCapabilities([...inputs.filter((input) => !capabilityFamily(input)), ...queryMatches])
  const canonicalIds = [...new Set([
    ...resolved.matches.map((match) => match.canonical_id),
    ...queryMatches,
  ])]

  return NextResponse.json({
    query: q,
    normalized_query: canonicalize(q),
    canonical_ids: canonicalIds,
    families: families.map((family) => ({ id: family.id, label: family.label, purchasable: false,
      descendant_ids: familyCapabilities(family).map((capability) => capability.id) })),
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
