import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
 request: NextRequest,
 { params }: { params: Promise<{ id: string }> }
) {
 try {
 const { id } = await params

 // Use raw SQL to avoid schema mismatch
 const result = await (db as any).$client.execute(
 'SELECT * FROM agents WHERE id = ? LIMIT 1',
 [id]
 ).catch(() => null)

 const row = result?.rows?.[0]

 if (!row) {
 return NextResponse.json(
 { error: 'not_found', message: 'Agent not found' },
 { status: 404 }
 )
 }

 // Parse capabilities safely
 const capabilities = (() => {
 const raw = (row as any).capabilities || (row as any)[3] || '[]'
 try { return JSON.parse(String(raw)) }
 catch { return [] }
 })()

 // Parse benchmark history safely
 const benchmarkHistory = (() => {
 const raw = (row as any).benchmark_history || '[]'
 try { return JSON.parse(String(raw)) }
 catch { return [] }
 })()

 const agent = {
 id: (row as any).id || (row as any)[0],
 name: (row as any).name || (row as any)[1],
 description: (row as any).description || (row as any)[2],
 capabilities,
 endpoint: (row as any).endpoint || (row as any)[4],
 owner_address: (row as any).owner_address || (row as any)[5],
 status: (row as any).status || (row as any)[6] || 'active',
 avg_rating: (row as any).avg_rating,
 rating_count: (row as any).rating_count || 0,
 created_at: (row as any).created_at,
 version: (row as any).version || 1,
 base_agent_id: (row as any).base_agent_id,
 model_id: (row as any).model_id,
 benchmark_score: (row as any).benchmark_score,
 benchmark_count: (row as any).benchmark_count || 0,
 benchmark_history: benchmarkHistory,
 velocity_score: (row as any).velocity_score,
 improvement_count: (row as any).improvement_count || 0,
 }

 // Get ratings for this agent
 const ratingsResult = await (db as any).$client.execute(
 'SELECT * FROM ratings WHERE rated_agent_id = ? ORDER BY created_at DESC LIMIT 10',
 [id]
 ).catch(() => null)
 const ratings = ratingsResult?.rows || []

 // Get benchmarks for this agent
 const benchmarksResult = await (db as any).$client.execute(
 'SELECT * FROM benchmarks WHERE agent_id = ? ORDER BY created_at DESC LIMIT 5',
 [id]
 ).catch(() => null)
 const benchmarks = benchmarksResult?.rows || []

 return NextResponse.json({
 ...agent,
 ratings,
 recent_benchmarks: benchmarks,
 }, {
 headers: { 'Cache-Control': 'no-store' }
 })

 } catch (err: any) {
 console.error('[agent detail]', err)
 return NextResponse.json(
 { error: 'internal_error', message: err.message },
 { status: 500 }
 )
 }
}
