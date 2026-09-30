import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { service_definitions } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { changeServiceStatus, serviceDefinitionDto } from '@/lib/service-definitions'
import { internalErrorResponse } from '@/lib/api-error'
import { isPublicMarketplaceSeller } from '@/lib/listing-visibility'
import { referenceFleetPaidServicePublicationLocked } from '@/lib/reference-fleet-control'

export const dynamic = 'force-dynamic'
const stateChange = z.object({ status: z.enum(['active', 'paused', 'unavailable', 'archived']) }).strict()

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const [service] = await db.select().from(service_definitions).where(eq(service_definitions.id, id)).limit(1)
    if (!service) return NextResponse.json({ success: false, error_code: 'SERVICE_NOT_FOUND', message: 'Service not found', retryable: false }, { status: 404 })
    if (service.status !== 'active' || !await isPublicMarketplaceSeller(service.seller_id)) {
      const principal = await resolveRequestPrincipal(request)
      if (principal?.userId !== service.seller_id) return NextResponse.json({ success: false, error_code: 'SERVICE_NOT_FOUND', message: 'Service not found', retryable: false }, { status: 404 })
    }
    return NextResponse.json({ service: await serviceDefinitionDto(service) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Service fetch failed', error)
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ success: false, error_code: 'UNAUTHORIZED', message: 'Authentication required', retryable: false }, { status: 401 })
  if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ success: false, error_code: 'CSRF_REJECTED', message: 'CSRF validation failed', retryable: false }, { status: 403 })
  const parsed = stateChange.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ success: false, error_code: 'INVALID_STATE', message: 'Unsupported service state', retryable: false }, { status: 400 })
  try {
    const { id } = await params
    if (parsed.data.status === 'active' && await referenceFleetPaidServicePublicationLocked(principal.agentId)) {
      return NextResponse.json({ success: false, error_code: 'REFERENCE_FLEET_PAID_SERVICES_LOCKED', message: 'Managed reference agents cannot publish paid services', retryable: false }, { status: 409 })
    }
    const service = await changeServiceStatus(id, principal.userId, parsed.data.status)
    if (!service) return NextResponse.json({ success: false, error_code: 'SERVICE_NOT_FOUND', message: 'Service not found or archived', retryable: false }, { status: 404 })
    return NextResponse.json({ service: await serviceDefinitionDto(service) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Service state change failed', error)
  }
}
