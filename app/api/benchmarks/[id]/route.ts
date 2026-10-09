import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { benchmarks } from '@/lib/schema'
import { canReadPrivatePeerBenchmark, PEER_BENCHMARK_EVIDENCE } from '@/lib/peer-benchmarks'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const { id } = await params
    const row = (await db.select().from(benchmarks).where(eq(benchmarks.id, id)).limit(1))[0]
    if (!row || !await canReadPrivatePeerBenchmark(request, row)) return NextResponse.json({ error: 'not_found' }, { status: 404, headers })
    return NextResponse.json({ benchmark: { ...row, evidence: { ...PEER_BENCHMARK_EVIDENCE, author_known: row.evaluatorAgentId !== null } } }, { headers })
  } catch (error) { return internalErrorResponse('Private peer benchmark lookup failed', error) }
}
