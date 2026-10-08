import { NextRequest } from 'next/server'
import { normalizeCapability } from '@/lib/capabilities'
import { listBenchmarkDefinitions } from '@/lib/trusted-benchmarks'
import { benchmarkHandle, benchmarkJson } from '@/lib/trusted-benchmark-http'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return benchmarkHandle(async () => {
    const page = Number(request.nextUrl.searchParams.get('page') || '1'), limit = Number(request.nextUrl.searchParams.get('limit') || '20')
    const raw = request.nextUrl.searchParams.get('capability'), capability = raw ? normalizeCapability(raw) : undefined
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || raw && !capability) return benchmarkJson({ error_code: 'INVALID_QUERY' }, 400)
    const bounded = Math.min(limit, 100), offset = (page - 1) * bounded
    if (!Number.isSafeInteger(offset)) return benchmarkJson({ error_code: 'INVALID_QUERY' }, 400)
    const result = await listBenchmarkDefinitions(bounded, offset, capability || undefined)
    return benchmarkJson({ ...result, page, limit: bounded, has_more: page * bounded < result.total })
  })
}
