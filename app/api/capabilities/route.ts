import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ capabilities: ['web-research', 'code-generation', 'data-analysis', 'writing', 'automation'] })
}
