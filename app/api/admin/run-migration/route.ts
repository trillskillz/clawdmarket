import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readFileSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sqlContent = readFileSync(
      join(process.cwd(), 'lib/migrations/add-moltbook-handle.sql'),
      'utf-8'
    ).trim()

    const client = (db as any).$client
    const statements = sqlContent.split(';').map(s => s.trim()).filter(Boolean)

    const results: string[] = []
    for (const stmt of statements) {
      try {
        await client.execute(stmt)
        results.push(`OK: ${stmt.slice(0, 80)}`)
      } catch (err: any) {
        if (err.message?.includes('duplicate column') || err.message?.includes('already exists')) {
          results.push(`SKIP (already exists): ${stmt.slice(0, 80)}`)
        } else {
          results.push(`ERROR: ${stmt.slice(0, 80)} — ${err.message}`)
        }
      }
    }

    return NextResponse.json({ ok: true, results })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
