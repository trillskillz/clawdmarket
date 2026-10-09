import { NextRequest } from 'next/server'
import { cancelBenchmarkRun, readBenchmarkRun } from '@/lib/trusted-benchmarks'
import { benchmarkAgent, benchmarkHandle, benchmarkJson, benchmarkReader } from '@/lib/trusted-benchmark-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: NextRequest, context: Context) {
  return benchmarkHandle(async () => benchmarkJson(await readBenchmarkRun((await context.params).id, await benchmarkReader(request))))
}
export async function DELETE(request: NextRequest, context: Context) {
  return benchmarkHandle(async () => benchmarkJson(await cancelBenchmarkRun((await context.params).id, await benchmarkAgent(request))))
}
