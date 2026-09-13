import { NextResponse } from 'next/server'
import packageJson from '../../../../package.json'
import { inspectRuntimeReadiness } from '@/lib/runtime-readiness'

export const dynamic = 'force-dynamic'

export async function GET() {
  const readiness = await inspectRuntimeReadiness()
  return NextResponse.json(
    {
      status: readiness.ready ? 'ready' : 'not_ready',
      version: packageJson.version,
      timestamp: new Date().toISOString(),
      checks: {
        configuration: readiness.configuration,
        database: readiness.database,
        payments: readiness.payments,
        password_reset_email: readiness.password_reset_email,
      },
    },
    {
      status: readiness.ready ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store',
        ...(!readiness.ready ? { 'Retry-After': '5' } : {}),
      },
    },
  )
}
