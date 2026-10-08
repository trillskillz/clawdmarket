import { NextRequest } from 'next/server'
import { createBenchmarkRun } from '@/lib/trusted-benchmarks'
import { benchmarkAgent, benchmarkBody, benchmarkHandle, benchmarkJson, benchmarkLimit } from '@/lib/trusted-benchmark-http'

export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest) {
  return benchmarkHandle(async () => {
    const agent = await benchmarkAgent(request)
    await benchmarkLimit(agent)
    const result = await createBenchmarkRun(agent, await benchmarkBody(request))
    return benchmarkJson(result, result.reused ? 200 : 201)
  })
}
