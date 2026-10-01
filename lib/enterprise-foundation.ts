import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organizations, organization_memberships } from '@/lib/schema'

export const organizationInput = z.object({
  client_reference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  name: z.string().trim().min(1).max(120),
}).strict()

export const assignmentInput = z.object({
  agent_id: z.string().min(1).max(200),
  cost_center: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),
  team_id: z.uuid().optional(),
}).strict()

export const teamInput = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(120),
}).strict()

export const invitationInput = z.object({
  client_reference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  target_account_id: z.string().min(1).max(200),
}).strict()

export async function loadOrganizationAccess(organizationId: string, accountId: string) {
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1)
  if (!organization) return null
  if (organization.owner_account_id === accountId) return { organization, role: 'owner' as const }
  const [membership] = await db.select({ account_id: organization_memberships.account_id }).from(organization_memberships).where(and(
    eq(organization_memberships.organization_id, organizationId), eq(organization_memberships.account_id, accountId),
    eq(organization_memberships.status, 'active'))).limit(1)
  return membership ? { organization, role: 'viewer' as const } : null
}

export function enterpriseFoundationEnabled() {
  return process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED === 'true'
    || (process.env.NODE_ENV !== 'production' && process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED !== 'false')
}

export function organizationDto(row: { id: string, name: string, created_at: Date, updated_at: Date }) {
  return { id: row.id, name: row.name, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
    authority: 'accounting_only' as const }
}

export function teamDto(row: { id: string, slug: string, name: string, status: string, created_at: Date, updated_at: Date }) {
  return { id: row.id, slug: row.slug, name: row.name, status: row.status,
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(), authority: 'accounting_only' as const }
}
