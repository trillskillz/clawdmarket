import { getCapabilityHierarchy } from '@/lib/capability-hierarchy'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(getCapabilityHierarchy(), { headers: {
    'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*',
    'Link': '</api/capabilities>; rel="related"',
  } })
}
