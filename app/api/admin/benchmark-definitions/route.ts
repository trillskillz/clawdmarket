import { NextRequest } from 'next/server'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { authorizeAdmin } from '@/lib/admin-auth'
import { validateCsrf } from '@/lib/csrf'
import { benchmarkBody, benchmarkHandle, benchmarkHeaders, benchmarkJson, benchmarkLimit } from '@/lib/trusted-benchmark-http'
import { publishBenchmarkDefinition } from '@/lib/trusted-benchmarks'

export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest) {
  return benchmarkHandle(async () => {
    const auth = await resolveAuthenticatedOwnerAccount(request)
    const denied = authorizeAdmin(auth)
    if (denied) { for (const [key, value] of Object.entries(benchmarkHeaders)) denied.headers.set(key, value); return denied }
    if (auth!.usesCookieAuth && !validateCsrf(request)) return benchmarkJson({ error_code: 'CSRF_REJECTED' }, 403)
    await benchmarkLimit(`admin:${auth!.userId}`)
    const result = await publishBenchmarkDefinition(auth!.userId, await benchmarkBody(request))
    return benchmarkJson(result, result.reused ? 200 : 201)
  })
}
