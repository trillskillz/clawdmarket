import { NextRequest } from 'next/server'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { authorizeAdmin } from '@/lib/admin-auth'
import { validateCsrf } from '@/lib/csrf'
import { benchmarkHandle, benchmarkHeaders, benchmarkJson } from '@/lib/trusted-benchmark-http'
import { retireBenchmarkDefinition } from '@/lib/trusted-benchmarks'

export const dynamic = 'force-dynamic'
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return benchmarkHandle(async () => {
    const auth = await resolveAuthenticatedOwnerAccount(request)
    const denied = authorizeAdmin(auth)
    if (denied) { for (const [key, value] of Object.entries(benchmarkHeaders)) denied.headers.set(key, value); return denied }
    if (auth!.usesCookieAuth && !validateCsrf(request)) return benchmarkJson({ error_code: 'CSRF_REJECTED' }, 403)
    return benchmarkJson(await retireBenchmarkDefinition((await context.params).id, auth!.userId))
  })
}
