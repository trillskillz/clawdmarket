import { NextRequest, NextResponse } from 'next/server'
import { resolveRegisteredAgentRequest } from './registered-agent-auth'
import { resolveAuthenticatedOwnerAccount } from './agent-owner-auth'
import { readBoundedJson, ArtifactError } from './private-artifacts'
import { TrustedBenchmarkError, type BenchmarkReader } from './trusted-benchmarks'
import { rateLimit } from './rate-limit'

export const benchmarkHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' }
export const benchmarkJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: benchmarkHeaders })
export async function benchmarkAgent(request: NextRequest) {
  const auth = await resolveRegisteredAgentRequest(request)
  if (auth.kind !== 'agent') throw new TrustedBenchmarkError('BENCHMARK_AUTH_REQUIRED', auth.kind === 'forbidden' ? 403 : 401)
  return auth.agentId
}
export async function benchmarkReader(request: NextRequest): Promise<BenchmarkReader> {
  const owner = await resolveAuthenticatedOwnerAccount(request)
  if (owner) return { ownerId: owner.userId }
  return { agentId: await benchmarkAgent(request) }
}
export async function benchmarkBody(request: NextRequest) { return readBoundedJson(request, 65_536, 10_000) }
export async function benchmarkLimit(agent: string) {
  if (!(await rateLimit(`trusted-benchmark:${agent}`, { interval: 60_000, maxRequests: 30, failClosed: true })).success) throw new TrustedBenchmarkError('BENCHMARK_RATE_LIMIT', 429)
}
export async function benchmarkHandle(action: () => Promise<Response>) {
  try { return await action() } catch (error) {
    if (error instanceof TrustedBenchmarkError || error instanceof ArtifactError) return benchmarkJson({ error_code: error.code, retryable: error.status === 503 }, error.status)
    return benchmarkJson({ error_code: 'BENCHMARK_UNAVAILABLE', retryable: true }, 503)
  }
}
