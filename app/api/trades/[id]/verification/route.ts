import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { trade_deliveries, trades, verification_results } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { internalErrorResponse } from '@/lib/api-error'

import { listPrivateArtifacts, privateArtifactHeaders } from '@/lib/private-artifacts'
import { tradeAcceptanceStatus } from '@/lib/trade-acceptance'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ success: false, error_code: 'UNAUTHORIZED', message: 'Authentication required', retryable: false }, { status: 401 })
  try {
    const { id } = await params
    const [trade] = await db.select({ id: trades.id, buyer_id: trades.buyer_id, seller_id: trades.seller_id }).from(trades).where(eq(trades.id, id)).limit(1)
    if (!trade || principal.userId !== trade.buyer_id && principal.userId !== trade.seller_id) {
      return NextResponse.json({ success: false, error_code: 'TRADE_NOT_FOUND', message: 'Trade not found', retryable: false }, { status: 404 })
    }
    const [delivery] = await db.select({ id: trade_deliveries.id, content_hash: trade_deliveries.content_hash }).from(trade_deliveries).where(eq(trade_deliveries.trade_id, id)).limit(1)
    const rows = await db.select().from(verification_results).where(eq(verification_results.trade_id, id)).orderBy(verification_results.created_at)
    const current = rows.filter((row) => row.delivery_id === delivery?.id)
    const status = (method: string) => current.find((row) => row.method === method)?.status || 'unverified'
    return NextResponse.json({
      trade_id: id,
      delivery: delivery ? { id: delivery.id, content_hash: delivery.content_hash } : null,
      artifacts: await listPrivateArtifacts(id, principal.userId),
      acceptance: await tradeAcceptanceStatus(id),
      categories: {
        delivery_received: Boolean(delivery),
        structure_verified: ['structure', 'schema'].some((method) => status(method) === 'passed'),
        artifact_integrity_verified: status('artifact_integrity') === 'passed',
        source_list_verified: status('source_urls') === 'passed',
        assertions_verified: status('assertions') === 'passed',
        declared_source_evidence_verified: status('source_evidence') === 'passed',
        isolated_checks_attested: status('isolated_checks') === 'passed',
        isolation_observed_by_app: false,
        semantic_verified: false,
        deterministic_tests_passed: status('isolated_checks') === 'passed' && current.some((row) => row.method === 'isolated_checks' && ['javascript_tests_v1', 'python_tests_v1'].includes(JSON.parse(row.evidence_json).adapter)),
        static_analysis_passed: status('isolated_checks') === 'passed' && current.some((row) => row.method === 'isolated_checks' && JSON.parse(row.evidence_json).adapter === 'javascript_static_v1'),
        provenance_verified: false,
        benchmark_verified: false,
        buyer_accepted: status('buyer_review') === 'passed',
      },
      results: rows.map((row) => ({ id: row.id, delivery_id: row.delivery_id, content_hash: row.content_hash,
        method: row.method, verifier: row.verifier, version: row.version, status: row.status, score: row.score,
        evidence: JSON.parse(row.evidence_json), failure: row.failure, created_at: row.created_at, updated_at: row.updated_at })),
    }, { headers: privateArtifactHeaders })
  } catch (error) {
    return internalErrorResponse('Verification lookup failed', error)
  }
}
