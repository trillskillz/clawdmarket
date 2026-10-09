import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { service_definitions, agent_owners } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { canonicalServiceCapabilities, serviceDefinitionDto, serviceDefinitionInput } from '@/lib/service-definitions'
import { internalErrorResponse } from '@/lib/api-error'
import { normalizeCapability } from '@/lib/capabilities'
import { referenceFleetPaidServicePublicationLocked } from '@/lib/reference-fleet-control'
import { reusableServiceSellerWritesEnabled } from '@/lib/routing-feature-flags'
import { capabilityFamily } from '@/lib/capability-hierarchy'
import { enterpriseFoundationEnabled } from '@/lib/enterprise-foundation'
import { capabilityArraySql, capabilityFamilyFilter } from '@/lib/capability-family-filter'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const parsedLimit = Number(request.nextUrl.searchParams.get('limit') || '20')
  const parsedPage = Number(request.nextUrl.searchParams.get('page') || '1')
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || !Number.isInteger(parsedPage) || parsedPage < 1) {
    return NextResponse.json({ success: false, error_code: 'INVALID_QUERY', message: 'page and limit must be positive integers', retryable: false }, { status: 400 })
  }
  const limit = Math.min(parsedLimit, 100)
  const page = parsedPage
  const capability = request.nextUrl.searchParams.get('capability')?.trim() || ''
  const canonicalCapability = capability ? normalizeCapability(capability) : null
  if (capability && !canonicalCapability) return NextResponse.json({ success: false, error_code: 'UNKNOWN_CAPABILITY', message: 'Capability is not in the canonical taxonomy', retryable: false }, { status: 400 })
  const familyInput = request.nextUrl.searchParams.get('family')?.trim() || ''
  const family = capabilityFamily(familyInput)
  if (familyInput && !family) return NextResponse.json({ success: false, error_code: 'UNKNOWN_CAPABILITY_FAMILY', message: 'Use a family ID from /api/capabilities/hierarchy', retryable: false }, { status: 400 })
  try {
    const conditions = [eq(service_definitions.status, 'active'), eq(service_definitions.visibility, 'public')]
    if (family) conditions.push(capabilityFamilyFilter(family, 'service_definitions.capabilities'))
    if (canonicalCapability) conditions.push(sql`EXISTS (SELECT 1 FROM json_each(${capabilityArraySql('service_definitions.capabilities')}) WHERE value = ${canonicalCapability})`)
    conditions.push(sql`(${service_definitions.seller_id} NOT GLOB 'user_agent_*' OR EXISTS (
      SELECT 1 FROM agents a WHERE ('user_agent_' || a.id) = ${service_definitions.seller_id}
        AND a.status = 'active' AND a.visibility = 'public' AND a.archived_at IS NULL
    ))`)
    const where = and(...conditions)
    const [{ total }] = await db.select({ total: sql<number>`COUNT(*)` }).from(service_definitions).where(where)
    const rows = await db.select().from(service_definitions).where(where)
      .orderBy(desc(service_definitions.created_at), desc(service_definitions.id)).limit(limit).offset((page - 1) * limit)
    return NextResponse.json({ services: await Promise.all(rows.map((service) => serviceDefinitionDto(service))), family: family?.id || null, page, limit, total: Number(total), has_more: page * limit < Number(total) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Service directory failed', error)
  }
}

export async function POST(request: NextRequest) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ success: false, error_code: 'UNAUTHORIZED', message: 'Authentication required', retryable: false }, { status: 401 })
  if (!reusableServiceSellerWritesEnabled(principal.userId)) return NextResponse.json({ success: false, error_code: 'REUSABLE_SERVICES_DISABLED', message: 'Reusable service creation is not enabled', retryable: true, state: 'no_funds_moved' }, { status: 503 })
  if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ success: false, error_code: 'CSRF_REJECTED', message: 'CSRF validation failed', retryable: false }, { status: 403 })
  const parsed = serviceDefinitionInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ success: false, error_code: 'INVALID_SERVICE', message: 'Service definition is invalid', retryable: false, details: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  try {
    if (input.visibility === 'organization') {
      const [owner] = principal.agentId ? await db.select().from(agent_owners).where(eq(agent_owners.agentId, principal.agentId)).limit(1) : []
      if (!owner) return NextResponse.json({ error_code: 'PRIVATE_PROVIDER_OWNER_REQUIRED' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } })
      if (!enterpriseFoundationEnabled()) return NextResponse.json({ error_code: 'PRIVATE_PROVIDERS_DISABLED' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
    }
    if (await referenceFleetPaidServicePublicationLocked(principal.agentId)) {
      return NextResponse.json({ success: false, error_code: 'REFERENCE_FLEET_PAID_SERVICES_LOCKED', message: 'Managed reference agents cannot publish paid services', retryable: false }, { status: 409 })
    }
    const [service] = await db.insert(service_definitions).values({
      visibility: input.visibility,
      id: crypto.randomUUID(), seller_id: principal.userId,
      title: input.title, description: input.description,
      capabilities: JSON.stringify(canonicalServiceCapabilities(input.capabilities)),
      input_schema: JSON.stringify(input.input_schema), output_schema: JSON.stringify(input.output_schema),
      pricing_model: 'fixed', price_minor: input.pricing.amount, currency: 'USD',
      estimated_latency_seconds: input.estimated_latency_seconds ?? null,
      max_concurrency: input.max_concurrency, execution_mode: 'contracted', provider_protocol: input.provider_protocol,
      verification_policy: JSON.stringify(input.verification_policy), status: input.status,
    }).returning()
    return NextResponse.json({ service: await serviceDefinitionDto(service, principal.userId) }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Service creation failed', error)
  }
}
