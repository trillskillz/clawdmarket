import { CAPABILITIES } from '@/lib/capabilities'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(CAPABILITIES, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Link': '</api/capabilities/resolve>; rel="service-desc", </api/capabilities/hierarchy>; rel="related"',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
