import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { organizations, organization_service_accounts, organization_audit_events } from '@/lib/schema'
import { isUserBanned } from '@/lib/agent-moderation'
import { withKeyedWriteLock } from '@/lib/service-reservation-lock'
import { hashAgentApiKey } from '@/lib/registered-agent-auth'

export const serviceAccountInput = z.object({
  client_reference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  name: z.string().trim().min(1).max(120),
  lifetime_days: z.number().int().min(1).max(90).default(30),
}).strict()

function credentialHash(token: string) {
  // The shared digest is keyed and domain separated; this token retains a distinct parser.
  return hashAgentApiKey(`organization-read:${token}`)
}

export function serviceAccountDto(row: typeof organization_service_accounts.$inferSelect) {
  return { id: row.id, name: row.name, credential_prefix: row.credential_prefix, status: row.status,
    expires_at: row.expires_at.toISOString(), created_at: row.created_at.toISOString(),
    authority: 'organization_read_only' as const }
}

/** This credential family is deliberately invisible to authenticateRequest and resolveRequestPrincipal. */
export async function resolveOrganizationServiceAccount(request: NextRequest) {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer (cmo_[a-f0-9]{64})$/.exec(header)
  if (!match) return null
  const [row] = await db.select({ id: organization_service_accounts.id,
    organization_id: organization_service_accounts.organization_id,
    owner_account_id: organizations.owner_account_id }).from(organization_service_accounts)
    .innerJoin(organizations, eq(organizations.id, organization_service_accounts.organization_id))
    .where(and(eq(organization_service_accounts.credential_hash, credentialHash(match[1])),
      eq(organization_service_accounts.status, 'active'), gt(organization_service_accounts.expires_at, new Date()))).limit(1)
  if (!row || await isUserBanned(row.owner_account_id)) return null
  return { id: row.id, organizationId: row.organization_id }
}

type CreateResult =
  | { kind: 'ok', row: typeof organization_service_accounts.$inferSelect, api_key: string | null, idempotent: boolean }
  | { kind: 'not_found' }
  | { kind: 'reference_conflict' }

function sqliteBusy(error: unknown) {
  let current = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'message' in current && /SQLITE_BUSY|database is locked/i.test(String(current.message))) return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

function accountWrite<T>(organizationId: string, run: () => Promise<T>) {
  return withKeyedWriteLock(`organization-service-account:${organizationId}`, async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { return await run() }
      catch (error) {
        if (!sqliteBusy(error) || attempt === 4) throw error
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
    throw new Error('organization_service_account_retry_exhausted')
  })
}

export async function createOrganizationServiceAccount(organizationId: string, ownerId: string,
  input: z.infer<typeof serviceAccountInput>): Promise<CreateResult> {
  const replay = async (): Promise<CreateResult | null> => {
    const [prior] = await db.select({ account: organization_service_accounts }).from(organization_service_accounts)
      .innerJoin(organizations, eq(organizations.id, organization_service_accounts.organization_id)).where(and(
        eq(organization_service_accounts.organization_id, organizationId),
        eq(organization_service_accounts.client_reference, input.client_reference),
        eq(organizations.owner_account_id, ownerId))).limit(1)
    if (!prior) return null
    return prior.account.name === input.name && prior.account.lifetime_days === input.lifetime_days
      ? { kind: 'ok', row: prior.account, api_key: null, idempotent: true }
      : { kind: 'reference_conflict' }
  }
  const prior = await replay()
  if (prior) return prior
  const apiKey = `cmo_${randomBytes(32).toString('hex')}`
  try {
    return await accountWrite(organizationId, () => db.transaction(async (tx): Promise<CreateResult> => {
      const [organization] = await tx.select({ id: organizations.id }).from(organizations).where(and(
        eq(organizations.id, organizationId), eq(organizations.owner_account_id, ownerId))).limit(1)
      if (!organization) return { kind: 'not_found' }
      const [existing] = await tx.select().from(organization_service_accounts).where(and(
        eq(organization_service_accounts.organization_id, organizationId),
        eq(organization_service_accounts.client_reference, input.client_reference))).limit(1)
      if (existing) return existing.name === input.name && existing.lifetime_days === input.lifetime_days
        ? { kind: 'ok', row: existing, api_key: null, idempotent: true } : { kind: 'reference_conflict' }
      const now = new Date()
      const [row] = await tx.insert(organization_service_accounts).values({ id: randomUUID(), organization_id: organizationId,
        client_reference: input.client_reference, name: input.name, lifetime_days: input.lifetime_days,
        credential_hash: credentialHash(apiKey), credential_prefix: apiKey.slice(0, 12),
        status: 'active', expires_at: new Date(now.getTime() + input.lifetime_days * 86_400_000), created_at: now }).returning()
      await tx.insert(organization_audit_events).values({ id: randomUUID(), organization_id: organizationId,
        actor_account_id: ownerId, action: 'service_account_created', service_account_id: row.id, created_at: now })
      return { kind: 'ok', row, api_key: apiKey, idempotent: false }
    }))
  } catch (error) {
    const raced = await replay()
    if (raced) return raced
    throw error
  }
}

export async function revokeOrganizationServiceAccount(organizationId: string, ownerId: string, accountId: string) {
  return accountWrite(organizationId, () => db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, organizationId), eq(organizations.owner_account_id, ownerId))).limit(1)
    if (!organization) return { kind: 'not_found' as const }
    const [current] = await tx.select().from(organization_service_accounts).where(and(
      eq(organization_service_accounts.id, accountId), eq(organization_service_accounts.organization_id, organizationId))).limit(1)
    if (!current) return { kind: 'not_found' as const }
    if (current.status === 'revoked') return { kind: 'ok' as const, row: current, idempotent: true }
    const now = new Date()
    const [row] = await tx.update(organization_service_accounts).set({ status: 'revoked', revoked_at: now }).where(and(
      eq(organization_service_accounts.id, accountId), eq(organization_service_accounts.organization_id, organizationId),
      eq(organization_service_accounts.status, 'active'))).returning()
    if (!row) return { kind: 'conflict' as const }
    await tx.insert(organization_audit_events).values({ id: randomUUID(), organization_id: organizationId,
      actor_account_id: ownerId, action: 'service_account_revoked', service_account_id: accountId, created_at: now })
    return { kind: 'ok' as const, row, idempotent: false }
  }))
}
