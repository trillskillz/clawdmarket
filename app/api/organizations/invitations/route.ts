import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organizations, organization_invitations } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { enterpriseFailure } from '@/lib/enterprise-api'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const account = await resolveAuthenticatedOwnerAccount(request)
    if (!account) return enterpriseFailure('OWNER_ACCOUNT_REQUIRED', 'Account required', 401)
    const rows = await db.select({ id: organization_invitations.id, organization_id: organizations.id,
      organization_name: organizations.name, expires_at: organization_invitations.expires_at,
      created_at: organization_invitations.created_at }).from(organization_invitations)
      .innerJoin(organizations, eq(organizations.id, organization_invitations.organization_id))
      .where(and(eq(organization_invitations.target_account_id, account.userId), eq(organization_invitations.status, 'pending')))
      .orderBy(desc(organization_invitations.created_at)).limit(100)
    const now = new Date()
    return NextResponse.json({ invitations: rows.map((row) => ({ ...row,
      expires_at: row.expires_at.toISOString(), created_at: row.created_at.toISOString(),
      acceptance_available: row.expires_at > now })) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Pending organization invitations lookup failed', error) }
}
