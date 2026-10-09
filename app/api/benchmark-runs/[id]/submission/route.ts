import { NextRequest } from 'next/server'
import { submitBenchmarkOutputs } from '@/lib/trusted-benchmarks'
import { benchmarkAgent, benchmarkBody, benchmarkHandle, benchmarkJson } from '@/lib/trusted-benchmark-http'

export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return benchmarkHandle(async () => benchmarkJson(await submitBenchmarkOutputs((await context.params).id, await benchmarkAgent(request), await benchmarkBody(request))))
}
