import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Retired endpoint: no profile, prompt, configuration or historical record is read. */
export async function GET(_request: NextRequest, _context: { params: Promise<{ id: string }> }) {
  return NextResponse.json({ error: 'lineage_removed' }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
}
