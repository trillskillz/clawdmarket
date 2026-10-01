import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organizations, organization_invitations, organization_memberships, organization_audit_events, users } from '@/lib/schema'
import { withKeyedWriteLock } from '@/lib/service-reservation-lock'

export type MembershipResult =
  | { kind: 'ok', idempotent: boolean, invitation_id?: string }
  | { kind: 'not_found' | 'target_not_found' | 'already_member' | 'reference_conflict' | 'expired' | 'unavailable' }

function retryableWriteConflict(error: unknown) {
  let current = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'message' in current && /SQLITE_BUSY|database is locked|SQLITE_CONSTRAINT_PRIMARYKEY|SQLITE_CONSTRAINT_UNIQUE/i.test(String(current.message))) return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

function membershipWrite<T>(_key: string, run: () => Promise<T>) {
  // Invitation volume is low. One local queue also serializes accept/cancel races that use different identifiers.
  // The SQL state predicates remain authoritative when different workers handle the same organization.
  return withKeyedWriteLock('organization-membership:all', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { return await run() }
      catch (error) {
        if (!retryableWriteConflict(error) || attempt === 4) throw error
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
    throw new Error('organization_membership_retry_exhausted')
  })
}

export async function createOrganizationInvitation(organizationId: string, ownerId: string, targetId: string, reference: string): Promise<MembershipResult> {
  const run = async () => db.transaction(async (tx): Promise<MembershipResult> => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, organizationId), eq(organizations.owner_account_id, ownerId))).limit(1)
    if (!organization) return { kind: 'not_found' }
    const [prior] = await tx.select().from(organization_invitations).where(and(
      eq(organization_invitations.organization_id, organizationId), eq(organization_invitations.client_reference, reference))).limit(1)
    if (prior) return prior.target_account_id === targetId
      ? { kind: 'ok', idempotent: true, invitation_id: prior.id } : { kind: 'reference_conflict' }
    if (targetId === ownerId) return { kind: 'already_member' }
    const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1)
    if (!target || target.id.startsWith('user_agent_')) return { kind: 'target_not_found' }
    const [membership] = await tx.select().from(organization_memberships).where(and(
      eq(organization_memberships.organization_id, organizationId), eq(organization_memberships.account_id, targetId))).limit(1)
    if (membership?.status === 'active') return { kind: 'already_member' }
    const now = new Date()
    const id = crypto.randomUUID()
    await tx.insert(organization_invitations).values({ id, organization_id: organizationId, client_reference: reference,
      target_account_id: targetId, status: 'pending', expires_at: new Date(now.getTime() + 7 * 86_400_000),
      created_at: now, updated_at: now })
    await tx.insert(organization_audit_events).values({ id: crypto.randomUUID(), organization_id: organizationId,
      actor_account_id: ownerId, action: 'member_invited', member_account_id: targetId, created_at: now })
    return { kind: 'ok', idempotent: false, invitation_id: id }
  })
  try { return await membershipWrite(`create:${organizationId}:${reference}`, run) }
  catch (error) {
    const [prior] = await db.select().from(organization_invitations).where(and(
      eq(organization_invitations.organization_id, organizationId), eq(organization_invitations.client_reference, reference))).limit(1)
    if (prior) return prior.target_account_id === targetId
      ? { kind: 'ok', idempotent: true, invitation_id: prior.id } : { kind: 'reference_conflict' }
    throw error
  }
}

export async function acceptOrganizationInvitation(invitationId: string, accountId: string): Promise<MembershipResult> {
  return membershipWrite(`accept-account:${accountId}`, () => db.transaction(async (tx): Promise<MembershipResult> => {
    const [invitation] = await tx.select().from(organization_invitations).where(and(
      eq(organization_invitations.id, invitationId), eq(organization_invitations.target_account_id, accountId))).limit(1)
    if (!invitation) return { kind: 'not_found' }
    const [membership] = await tx.select().from(organization_memberships).where(and(
      eq(organization_memberships.organization_id, invitation.organization_id), eq(organization_memberships.account_id, accountId))).limit(1)
    if (invitation.status === 'accepted' && membership?.status === 'active' && membership.accepted_invitation_id === invitationId)
      return { kind: 'ok', idempotent: true, invitation_id: invitationId }
    if (invitation.status !== 'pending') return { kind: 'unavailable' }
    const now = new Date()
    if (invitation.expires_at <= now) return { kind: 'expired' }
    if (membership?.status === 'active') return { kind: 'already_member' }
    const [accepted] = await tx.update(organization_invitations).set({ status: 'accepted', accepted_at: now, updated_at: now }).where(and(
      eq(organization_invitations.id, invitationId), eq(organization_invitations.status, 'pending'), gt(organization_invitations.expires_at, now))).returning()
    if (!accepted) return { kind: 'unavailable' }
    if (membership) await tx.update(organization_memberships).set({ status: 'active', role: 'viewer', accepted_invitation_id: invitationId, updated_at: now }).where(and(
      eq(organization_memberships.organization_id, invitation.organization_id), eq(organization_memberships.account_id, accountId),
      eq(organization_memberships.status, 'revoked')))
    else await tx.insert(organization_memberships).values({ organization_id: invitation.organization_id, account_id: accountId,
      role: 'viewer', status: 'active', accepted_invitation_id: invitationId, created_at: now, updated_at: now })
    await tx.insert(organization_audit_events).values({ id: crypto.randomUUID(), organization_id: invitation.organization_id,
      actor_account_id: accountId, action: 'member_joined', member_account_id: accountId, created_at: now })
    return { kind: 'ok', idempotent: false, invitation_id: invitationId }
  }))
}

export async function cancelOrganizationInvitation(organizationId: string, ownerId: string, invitationId: string): Promise<MembershipResult> {
  return membershipWrite(`invitation:${invitationId}`, () => db.transaction(async (tx): Promise<MembershipResult> => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, organizationId), eq(organizations.owner_account_id, ownerId))).limit(1)
    if (!organization) return { kind: 'not_found' }
    const [invitation] = await tx.select().from(organization_invitations).where(and(
      eq(organization_invitations.id, invitationId), eq(organization_invitations.organization_id, organizationId))).limit(1)
    if (!invitation) return { kind: 'not_found' }
    if (invitation.status === 'cancelled') return { kind: 'ok', idempotent: true }
    if (invitation.status !== 'pending') return { kind: 'unavailable' }
    const now = new Date()
    const [cancelled] = await tx.update(organization_invitations).set({ status: 'cancelled', cancelled_at: now, updated_at: now }).where(and(
      eq(organization_invitations.id, invitationId), eq(organization_invitations.status, 'pending'))).returning()
    if (!cancelled) return { kind: 'unavailable' }
    await tx.insert(organization_audit_events).values({ id: crypto.randomUUID(), organization_id: organizationId,
      actor_account_id: ownerId, action: 'invitation_cancelled', member_account_id: invitation.target_account_id, created_at: now })
    return { kind: 'ok', idempotent: false }
  }))
}

export async function revokeOrganizationMembership(organizationId: string, ownerId: string, memberId: string): Promise<MembershipResult> {
  return membershipWrite(`member:${organizationId}:${memberId}`, () => db.transaction(async (tx): Promise<MembershipResult> => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, organizationId), eq(organizations.owner_account_id, ownerId))).limit(1)
    if (!organization) return { kind: 'not_found' }
    const [membership] = await tx.select().from(organization_memberships).where(and(
      eq(organization_memberships.organization_id, organizationId), eq(organization_memberships.account_id, memberId))).limit(1)
    if (!membership) return { kind: 'not_found' }
    if (membership.status === 'revoked') return { kind: 'ok', idempotent: true }
    const now = new Date()
    const [revoked] = await tx.update(organization_memberships).set({ status: 'revoked', updated_at: now }).where(and(
      eq(organization_memberships.organization_id, organizationId), eq(organization_memberships.account_id, memberId),
      eq(organization_memberships.status, 'active'))).returning()
    if (!revoked) return { kind: 'unavailable' }
    const cancelled = await tx.update(organization_invitations).set({ status: 'cancelled', cancelled_at: now, updated_at: now }).where(and(
      eq(organization_invitations.organization_id, organizationId), eq(organization_invitations.target_account_id, memberId),
      eq(organization_invitations.status, 'pending'))).returning({ id: organization_invitations.id })
    if (cancelled.length) await tx.insert(organization_audit_events).values(cancelled.map(() => ({
      id: crypto.randomUUID(), organization_id: organizationId, actor_account_id: ownerId,
      action: 'invitation_cancelled' as const, member_account_id: memberId, created_at: now,
    })))
    await tx.insert(organization_audit_events).values({ id: crypto.randomUUID(), organization_id: organizationId,
      actor_account_id: ownerId, action: 'member_revoked', member_account_id: memberId, created_at: now })
    return { kind: 'ok', idempotent: false }
  }))
}
