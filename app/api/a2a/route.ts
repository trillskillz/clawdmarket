import { NextRequest } from 'next/server'
import { handleA2A } from '@/lib/a2a-marketplace'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  return handleA2A(request)
}
