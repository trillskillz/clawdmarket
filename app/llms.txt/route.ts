import { renderLlmsTxt } from '@/lib/agent-contract'

export async function GET() {
  return new Response(renderLlmsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
