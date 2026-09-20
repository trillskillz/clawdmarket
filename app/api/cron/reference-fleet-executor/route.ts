import { NextRequest, NextResponse } from 'next/server'
import { internalErrorResponse } from '@/lib/api-error'
import { runReferenceFleetExecutions } from '@/lib/reference-fleet-executor'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runReferenceFleetExecutions()
    return NextResponse.json({ ...result, checked_at: new Date().toISOString() }, {
      status: result.ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return internalErrorResponse('Reference fleet execution failed', error, {
      code: 'reference_fleet_execution_failed',
      message: 'The managed capability executor could not run. Inspect the error ID and execution monitor.',
      status: 503,
    })
  }
}
