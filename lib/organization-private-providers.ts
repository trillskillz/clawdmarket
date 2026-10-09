import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { agents, agent_owners, organizations, organization_teams, organization_agent_assignments, organization_memberships,
  organization_purchasing_roles, organization_provider_shares as shares, service_definitions, organization_audit_events } from './schema'
import { enterpriseFoundationEnabled } from './enterprise-foundation'
import { purchasingTransaction, PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'

const reference = z.string().trim().min(8).max(200)
export const providerOfferInput = z.object({ version:z.literal(1),client_reference:reference,organization_id:z.string().uuid(),
  team_id:z.string().uuid().nullable(),expires_at:z.string().datetime({offset:true}).transform(value=>new Date(value)) }).strict()
export const providerAcceptInput = z.object({ version:z.literal(1),client_reference:reference,request_hash:z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const live = (value:Date) => Number.isFinite(value.getTime()) && value.getTime()>Date.now()
function writes() { if (!enterpriseFoundationEnabled()) throw new PurchasingError('PRIVATE_PROVIDERS_DISABLED',503) }
const digest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function providerOwner(serviceId:string, actor:string, source:PurchasingSource=db) {
  const [row] = await source.select({service:service_definitions,agent:agents}).from(service_definitions)
    .innerJoin(agents,sql`${service_definitions.seller_id} = ('user_agent_' || ${agents.id})`)
    .where(eq(service_definitions.id,serviceId)).limit(1)
  if (!row || row.service.visibility !== 'organization') throw new PurchasingError('PRIVATE_SERVICE_NOT_FOUND',404)
  const [owner] = await source.select().from(agent_owners).where(and(eq(agent_owners.agentId,row.agent.id),eq(agent_owners.userId,actor))).limit(1)
  if (!owner) throw new PurchasingError('PRIVATE_SERVICE_NOT_FOUND',404)
  return row
}
async function scope(row: typeof shares.$inferSelect, source:PurchasingSource, pending=false) {
  if (!live(row.expires_at) || (pending ? row.state !== 'pending' : row.state !== 'active')) throw new PurchasingError('PROVIDER_SHARE_INACTIVE')
  if (!pending && (!row.accept_reference || !row.accept_hash || !row.accepted_at || !Number.isFinite(row.accepted_at.getTime())
    || row.accept_hash !== digest({actor:row.organization_owner_id,version:1,client_reference:row.accept_reference,request_hash:row.request_hash}))) throw new PurchasingError('PROVIDER_SHARE_CONSENT_MISSING')
  const [org] = await source.select().from(organizations).where(eq(organizations.id,row.organization_id)).limit(1)
  if (!org || org.owner_account_id !== row.organization_owner_id) throw new PurchasingError('PROVIDER_SHARE_OWNER_CHANGED')
  const provider = await providerOwner(row.service_id,row.provider_owner_id,source)
  if (provider.agent.id !== row.provider_agent_id || provider.agent.status !== 'active' || provider.agent.archivedAt
    || provider.service.status !== 'active') throw new PurchasingError('PRIVATE_PROVIDER_UNAVAILABLE')
  if (row.team_id) {
    const [team] = await source.select().from(organization_teams).where(and(eq(organization_teams.id,row.team_id),eq(organization_teams.organization_id,org.id))).limit(1)
    if (!team || team.status !== 'active') throw new PurchasingError('PROVIDER_SHARE_DEPARTMENT_UNAVAILABLE')
  }
  return {org,...provider}
}
async function audit(row:typeof shares.$inferSelect,actor:string,action:typeof organization_audit_events.$inferInsert['action'],source:PurchasingSource) {
  await source.insert(organization_audit_events).values({id:randomUUID(),organization_id:row.organization_id,actor_account_id:actor,action,
    agent_id:row.provider_agent_id,team_id:row.team_id,created_at:new Date()})
}
export async function offerPrivateProvider(serviceId:string,actor:string,input:z.output<typeof providerOfferInput>) {
  return purchasingTransaction(async tx=>{
    const provider = await providerOwner(serviceId,actor,tx), fingerprint = digest({serviceId,actor,...input,expires_at:input.expires_at.toISOString()})
    const [prior] = await tx.select().from(shares).where(and(eq(shares.provider_owner_id,actor),eq(shares.client_reference,input.client_reference))).limit(1)
    if (prior) {
      if (prior.request_hash !== fingerprint) throw new PurchasingError('PROVIDER_SHARE_REFERENCE_CONFLICT')
      return {share:prior,idempotent:true}
    }
    writes()
    if (!live(input.expires_at) || input.expires_at.getTime()>Date.now()+30*86400_000) throw new PurchasingError('PROVIDER_SHARE_EXPIRY_INVALID',400)
    const [org] = await tx.select().from(organizations).where(eq(organizations.id,input.organization_id)).limit(1)
    if (!org) throw new PurchasingError('ORGANIZATION_NOT_FOUND',404)
    const proposed = {id:randomUUID(),organization_id:org.id,organization_owner_id:org.owner_account_id,provider_owner_id:actor,
      provider_agent_id:provider.agent.id,service_id:serviceId,team_id:input.team_id,client_reference:input.client_reference,request_hash:fingerprint,
      accept_reference:null,accept_hash:null,state:'pending' as const,expires_at:input.expires_at,created_at:new Date(),accepted_at:null,revoked_at:null,revoked_by:null}
    await scope(proposed,tx,true)
    const [row] = await tx.insert(shares).values(proposed).returning();await audit(row,actor,'provider_share_offered',tx)
    return {share:row,idempotent:false}
  })
}
export async function acceptPrivateProvider(orgId:string,shareId:string,actor:string,input:z.output<typeof providerAcceptInput>) {
  return purchasingTransaction(async tx=>{
    const [row] = await tx.select().from(shares).where(and(eq(shares.id,shareId),eq(shares.organization_id,orgId))).limit(1)
    const [org] = await tx.select().from(organizations).where(eq(organizations.id,orgId)).limit(1)
    if (!row || !org || org.owner_account_id !== actor) throw new PurchasingError('PROVIDER_SHARE_NOT_FOUND',404)
    if (row.organization_owner_id !== actor) throw new PurchasingError('PROVIDER_SHARE_OWNER_CHANGED')
    const fingerprint = digest({actor,...input})
    if (row.accept_hash) {
      if (row.accept_hash !== fingerprint) throw new PurchasingError('PROVIDER_SHARE_DECISION_CONFLICT')
      return {share:row,idempotent:true}
    }
    writes();await scope(row,tx,true)
    if (row.request_hash !== input.request_hash) throw new PurchasingError('PROVIDER_SHARE_DECISION_MISMATCH')
    const [updated] = await tx.update(shares).set({state:'active',accept_reference:input.client_reference,accept_hash:fingerprint,accepted_at:new Date()})
      .where(and(eq(shares.id,shareId),eq(shares.state,'pending'))).returning()
    if (!updated) throw new PurchasingError('PROVIDER_SHARE_STATE_CHANGED')
    await audit(updated,actor,'provider_share_accepted',tx);return {share:updated,idempotent:false}
  })
}
export async function revokePrivateProvider(shareId:string,actor:string,sourceOrg?:string,sourceService?:string) {
  return purchasingTransaction(async tx=>{
    const [row] = await tx.select().from(shares).where(eq(shares.id,shareId)).limit(1)
    if (!row || sourceOrg && row.organization_id !== sourceOrg || sourceService && row.service_id !== sourceService) throw new PurchasingError('PROVIDER_SHARE_NOT_FOUND',404)
    const [org] = await tx.select().from(organizations).where(eq(organizations.id,row.organization_id)).limit(1)
    if (org?.owner_account_id !== actor) await providerOwner(row.service_id,actor,tx)
    if (row.state === 'revoked') return row
    const [updated] = await tx.update(shares).set({state:'revoked',revoked_by:actor,revoked_at:new Date()}).where(eq(shares.id,shareId)).returning()
    await audit(updated,actor,'provider_share_revoked',tx);return updated
  })
}
async function activeDepartment(teamId:string|null,orgId:string,source:PurchasingSource) {
  if (!teamId) return
  const [team]=await source.select().from(organization_teams).where(and(eq(organization_teams.id,teamId),eq(organization_teams.organization_id,orgId))).limit(1)
  if (!team || team.status !== 'active') throw new PurchasingError('PROVIDER_SHARE_DEPARTMENT_UNAVAILABLE')
}
export async function privateProviderAccess(service:typeof service_definitions.$inferSelect,buyerId:string,shareId:string|undefined,
  source:PurchasingSource=db,requireWrites=true) {
  if (service.visibility === 'public') {
    if (shareId) throw new PurchasingError('PROVIDER_SHARE_SCOPE_MISMATCH')
    return undefined
  }
  if (service.visibility !== 'organization' || !shareId || !buyerId.startsWith('user_agent_')) throw new PurchasingError('PRIVATE_SERVICE_NOT_FOUND',404)
  if (requireWrites) writes()
  const [row] = await source.select().from(shares).where(eq(shares.id,shareId)).limit(1)
  if (!row || row.service_id !== service.id) throw new PurchasingError('PRIVATE_SERVICE_NOT_FOUND',404)
  const current = await scope(row,source), agentId = buyerId.slice('user_agent_'.length)
  const [assignment] = await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id,agentId)).limit(1)
  const [owner] = await source.select().from(agent_owners).where(and(eq(agent_owners.agentId,agentId),eq(agent_owners.userId,current.org.owner_account_id))).limit(1)
  const [buyer] = await source.select().from(agents).where(eq(agents.id,agentId)).limit(1)
  if (!assignment || assignment.organization_id !== row.organization_id || row.team_id && assignment.team_id !== row.team_id
    || !owner || !buyer || buyer.status !== 'active' || buyer.archivedAt) throw new PurchasingError('PROVIDER_SHARE_BUYER_SCOPE_CHANGED')
  await activeDepartment(assignment.team_id,row.organization_id,source)
  return row
}
export async function providerOwnerShares(serviceId:string,actor:string) {
  await providerOwner(serviceId,actor)
  return db.select().from(shares).where(eq(shares.service_id,serviceId)).limit(100)
}
/** Catalog inspection is separate from spending, with no viewer/read-key widening. */
export async function organizationPrivateCatalog(orgId:string,actor:string,agentId?:string|null,roleId?:string|null) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id,orgId)).limit(1)
  if (!org) throw new PurchasingError('ORGANIZATION_NOT_FOUND',404)
  let team:string|null=null,ceiling:number|null=null,owner=org.owner_account_id===actor
  if (!owner && agentId) {
    const [assignment] = await db.select().from(organization_agent_assignments).where(and(eq(organization_agent_assignments.agent_id,agentId),eq(organization_agent_assignments.organization_id,orgId))).limit(1)
    const [linked] = await db.select().from(agent_owners).where(and(eq(agent_owners.agentId,agentId),eq(agent_owners.userId,org.owner_account_id))).limit(1)
    const [buyer] = await db.select().from(agents).where(eq(agents.id,agentId)).limit(1)
    if (!assignment || !linked || !buyer || buyer.status !== 'active' || buyer.archivedAt || actor !== `user_agent_${agentId}`) throw new PurchasingError('PRIVATE_CATALOG_NOT_FOUND',404)
    await activeDepartment(assignment.team_id,orgId,db)
    team=assignment.team_id
  } else if (!owner) {
    if (!roleId) throw new PurchasingError('PRIVATE_CATALOG_NOT_FOUND',404)
    const [role] = await db.select().from(organization_purchasing_roles).where(eq(organization_purchasing_roles.id,roleId)).limit(1)
    const [member] = await db.select().from(organization_memberships).where(and(eq(organization_memberships.organization_id,orgId),eq(organization_memberships.account_id,actor),eq(organization_memberships.status,'active'))).limit(1)
    if (!member || !role || role.account_id !== actor || role.organization_id !== orgId || role.owner_account_id !== org.owner_account_id
      || role.state !== 'active' || !live(role.expires_at) || !Number.isSafeInteger(role.max_purchase_minor) || role.max_purchase_minor<1) throw new PurchasingError('PRIVATE_CATALOG_NOT_FOUND',404)
    await activeDepartment(role.team_id,orgId,db)
    team=role.team_id;ceiling=role.max_purchase_minor;owner=role.team_id===null
  }
  const rows=await db.select().from(shares).where(eq(shares.organization_id,orgId)).limit(100),result=[]
  for (const row of rows) {
    if (!owner && row.team_id && row.team_id !== team) continue
    // Pending offers are visible only to the accepting owner, with exact private terms.
    if (row.state !== 'active' && org.owner_account_id !== actor) continue
    try {
      const current=await scope(row,db,row.state==='pending')
      if (ceiling!==null && current.service.price_minor+Math.round(current.service.price_minor*.05)>ceiling) continue
      result.push({share:row,service:current.service})
    } catch (error) { if (!(error instanceof PurchasingError)) throw error }
  }
  return result
}
