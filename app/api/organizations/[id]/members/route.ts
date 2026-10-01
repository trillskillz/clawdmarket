import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organizations, organization_memberships } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { enterpriseFailure } from '@/lib/enterprise-api'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await resolveAuthenticatedOwnerAccount(request)
    if (!account) return enterpriseFailure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    const id = (await params).id
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, id), eq(organizations.owner_account_id, account.userId))).limit(1)
    if (!organization) return enterpriseFailure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    const rows = await db.select().from(organization_memberships).where(eq(organization_memberships.organization_id, id)).limit(100)
    return NextResponse.json({ members: rows.map((row) => ({ account_id: row.account_id, role: row.role,
      status: row.status, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() })) },
    { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization membership lookup failed', error) }
}
