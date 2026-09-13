import { NextRequest } from 'next/server'
import { renderSkillMd } from '@/lib/agent-contract'
import { getRequestOrigin } from '@/lib/request-origin'

export async function GET(request: NextRequest) {
  return new Response(renderSkillMd(getRequestOrigin(request)), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
