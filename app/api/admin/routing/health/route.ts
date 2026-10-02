import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { authorizeAdmin } from '@/lib/admin-auth'
import { getRoutingOperatorSnapshot } from '@/lib/routing-operator-snapshot'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' }

export async function GET(request: NextRequest) {
  const bearer = request.headers.get('authorization')
  const cookie = request.cookies.get('auth-token')?.value
  const auth = await authenticateRequest(bearer || (cookie ? `Bearer ${cookie}` : null))
  const error = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null)
  if (error) {
    for (const [name, value] of Object.entries(headers)) error.headers.set(name, value)
    return error
  }
  try {
    return NextResponse.json(await getRoutingOperatorSnapshot(), { headers })
  } catch (error) {
    const response = internalErrorResponse('Routing operator snapshot failed', error)
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    return response
  }
}
