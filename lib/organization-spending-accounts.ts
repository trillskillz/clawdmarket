import 'server-only'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from './db'
import { agents, agent_owners, organizations, organization_agent_assignments, organization_teams,
  organization_spending_accounts as accounts, organization_spending_uses as uses, organization_audit_events, service_definitions } from './schema'
import { money, serviceOrderInput } from './service-order-input'
import { hashAgentApiKey } from './registered-agent-auth'
import { enterpriseFoundationEnabled } from './enterprise-foundation'
import { privateProviderAccess } from './organization-private-providers'
import { purchasingTransaction, PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'
import { issueOrganizationSpendingEvidence, validOrganizationSpendingEvidence, type OrganizationSpendingEvidence } from './organization-spending-evidence'

const reference=z.string().trim().min(8).max(200)
const allowedService=z.object({service_id:z.string().uuid(),provider_share_id:z.string().uuid().nullable()}).strict()
export const spendingAccountInput=z.object({version:z.literal(1),client_reference:reference,name:z.string().trim().min(1).max(120),
  buyer_agent_id:z.string().min(1).max(200),team_id:z.string().uuid().nullable(),cost_center:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),allowed_services:z.array(allowedService).min(1).max(20).refine(rows=>new Set(rows.map(row=>row.service_id)).size===rows.length),
  max_purchase:money,max_daily:money,max_monthly:money,max_lifetime:money,
  expires_at:z.string().datetime({offset:true}).transform(value=>new Date(value))}).strict()
export const spendingOrderInput=z.object({service_id:z.string().uuid(),order:serviceOrderInput}).strict()
type Account=typeof accounts.$inferSelect
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const credentialHash=(key:string)=>hashAgentApiKey(`organization-spend:${key}`)
const live=(date:Date)=>Number.isFinite(date.getTime())&&date.getTime()>Date.now()
function writes(){if(!enterpriseFoundationEnabled())throw new PurchasingError('ORGANIZATION_SPENDING_DISABLED',503)}
function authority(row:Pick<Account,'organization_id'|'owner_account_id'|'buyer_agent_id'|'team_id'|'cost_center'|'client_reference'|'name'|'allowed_services_json'|'max_purchase_minor'|'max_daily_minor'|'max_monthly_minor'|'max_lifetime_minor'|'expires_at'>){
  return digest({version:1,organization_id:row.organization_id,owner_account_id:row.owner_account_id,buyer_agent_id:row.buyer_agent_id,
    team_id:row.team_id,cost_center:row.cost_center,client_reference:row.client_reference,name:row.name,allowed_services_json:row.allowed_services_json,
    max_purchase_minor:row.max_purchase_minor,max_daily_minor:row.max_daily_minor,max_monthly_minor:row.max_monthly_minor,max_lifetime_minor:row.max_lifetime_minor,
    expires_at:row.expires_at.toISOString()})
}
async function buyerScope(orgId:string,ownerId:string,agentId:string,source:PurchasingSource){
  const [org]=await source.select().from(organizations).where(eq(organizations.id,orgId)).limit(1)
  const [linked]=await source.select().from(agent_owners).where(and(eq(agent_owners.agentId,agentId),eq(agent_owners.userId,ownerId))).limit(1)
  const [buyer]=await source.select().from(agents).where(eq(agents.id,agentId)).limit(1)
  const [assignment]=await source.select().from(organization_agent_assignments).where(and(eq(organization_agent_assignments.agent_id,agentId),eq(organization_agent_assignments.organization_id,orgId))).limit(1)
  if(!org||org.owner_account_id!==ownerId||!linked||!buyer||buyer.status!=='active'||buyer.archivedAt||!assignment)throw new PurchasingError('SPENDING_BUYER_SCOPE_CHANGED',404)
  const banned=await source.all(sql`SELECT user_id FROM banned_users WHERE user_id IN (${ownerId},${`user_agent_${agentId}`}) LIMIT 1`)
  if(banned.length)throw new PurchasingError('SPENDING_ACCOUNT_UNAVAILABLE',401)
  if(assignment.team_id){const [team]=await source.select().from(organization_teams).where(and(eq(organization_teams.id,assignment.team_id),eq(organization_teams.organization_id,orgId))).limit(1)
    if(!team||team.status!=='active')throw new PurchasingError('SPENDING_DEPARTMENT_UNAVAILABLE')}
  return assignment
}
async function current(row:Account,source:PurchasingSource){
  if(row.state!=='active'||!live(row.expires_at))throw new PurchasingError('SPENDING_ACCOUNT_INACTIVE',401)
  for(const limit of [row.max_purchase_minor,row.max_daily_minor,row.max_monthly_minor,row.max_lifetime_minor])if(!Number.isSafeInteger(limit)||limit<1||limit>100_000_000_000)throw new PurchasingError('SPENDING_AUTHORITY_INVALID')
  let allowed:z.output<typeof allowedService>[]
  try{allowed=spendingAccountInput.shape.allowed_services.parse(JSON.parse(row.allowed_services_json));if(authority(row)!==row.authority_hash)throw Error('authority changed')}
  catch{throw new PurchasingError('SPENDING_AUTHORITY_INVALID')}
  const assignment=await buyerScope(row.organization_id,row.owner_account_id,row.buyer_agent_id,source)
  if(assignment.team_id!==row.team_id||assignment.cost_center!==row.cost_center)throw new PurchasingError('SPENDING_BUYER_SCOPE_CHANGED')
  return allowed
}
export function spendingAccountDto(row:Account){
  return {id:row.id,organization_id:row.organization_id,buyer_agent_id:row.buyer_agent_id,team_id:row.team_id,cost_center:row.cost_center,name:row.name,
    allowed_services:JSON.parse(row.allowed_services_json),max_purchase:(row.max_purchase_minor/100).toFixed(2),max_daily:(row.max_daily_minor/100).toFixed(2),
    max_monthly:(row.max_monthly_minor/100).toFixed(2),max_lifetime:(row.max_lifetime_minor/100).toFixed(2),state:row.state,expires_at:row.expires_at,created_at:row.created_at,
    revoked_at:row.revoked_at,credential_prefix:row.credential_prefix,authority:'approved_direct_service_credit' as const}
}
async function owned(orgId:string,actor:string,source:PurchasingSource){
  const [org]=await source.select().from(organizations).where(and(eq(organizations.id,orgId),eq(organizations.owner_account_id,actor))).limit(1)
  if(!org)throw new PurchasingError('ORGANIZATION_NOT_FOUND',404)
  return org
}
export async function createSpendingAccount(orgId:string,actor:string,input:z.output<typeof spendingAccountInput>){
  return purchasingTransaction(async tx=>{
    await owned(orgId,actor,tx)
    const assignment=await buyerScope(orgId,actor,input.buyer_agent_id,tx)
    if(assignment.team_id!==input.team_id||assignment.cost_center!==input.cost_center)throw new PurchasingError('SPENDING_BUYER_SCOPE_CHANGED')
    const proposed={organization_id:orgId,owner_account_id:actor,buyer_agent_id:input.buyer_agent_id,team_id:assignment.team_id,cost_center:assignment.cost_center,
      client_reference:input.client_reference,name:input.name,allowed_services_json:JSON.stringify(input.allowed_services),
      max_purchase_minor:input.max_purchase,max_daily_minor:input.max_daily,max_monthly_minor:input.max_monthly,max_lifetime_minor:input.max_lifetime,expires_at:input.expires_at}
    const hash=authority(proposed),[prior]=await tx.select().from(accounts).where(and(eq(accounts.organization_id,orgId),eq(accounts.client_reference,input.client_reference))).limit(1)
    if(prior){if(prior.authority_hash!==hash)throw new PurchasingError('SPENDING_REFERENCE_CONFLICT');return {account:spendingAccountDto(prior),api_key:null,idempotent:true}}
    writes();if(!live(input.expires_at)||input.expires_at.getTime()>Date.now()+30*86400_000)throw new PurchasingError('SPENDING_EXPIRY_INVALID',400)
    for(const offered of input.allowed_services){const [service]=await tx.select().from(service_definitions).where(eq(service_definitions.id,offered.service_id)).limit(1)
      if(!service||service.status!=='active')throw new PurchasingError('SPENDING_SERVICE_UNAVAILABLE',404)
      await privateProviderAccess(service,`user_agent_${input.buyer_agent_id}`,offered.provider_share_id??undefined,tx)}
    const key=`cmos_${randomBytes(32).toString('hex')}`,now=new Date()
    const [row]=await tx.insert(accounts).values({...proposed,id:randomUUID(),authority_hash:hash,credential_hash:credentialHash(key),credential_prefix:key.slice(0,12),state:'active',created_at:now}).returning()
    await tx.insert(organization_audit_events).values({id:randomUUID(),organization_id:orgId,actor_account_id:actor,action:'spending_account_created',spending_account_id:row.id,agent_id:row.buyer_agent_id,team_id:row.team_id,created_at:now})
    return {account:spendingAccountDto(row),api_key:key,idempotent:false}
  })
}
export async function revokeSpendingAccount(orgId:string,accountId:string,actor:string){
  return purchasingTransaction(async tx=>{await owned(orgId,actor,tx)
    const [row]=await tx.select().from(accounts).where(and(eq(accounts.id,accountId),eq(accounts.organization_id,orgId))).limit(1)
    if(!row)throw new PurchasingError('SPENDING_ACCOUNT_NOT_FOUND',404)
    if(row.state==='revoked')return spendingAccountDto(row)
    const [updated]=await tx.update(accounts).set({state:'revoked',revoked_at:new Date()}).where(eq(accounts.id,row.id)).returning()
    await tx.insert(organization_audit_events).values({id:randomUUID(),organization_id:orgId,actor_account_id:actor,action:'spending_account_revoked',spending_account_id:row.id,agent_id:row.buyer_agent_id,team_id:row.team_id,created_at:new Date()})
    return spendingAccountDto(updated)
  })
}
export async function inspectSpendingAccounts(orgId:string,actor:string){
  await owned(orgId,actor,db)
  const rows=await db.select().from(accounts).where(eq(accounts.organization_id,orgId)).limit(100)
  return Promise.all(rows.map(async row=>({account:spendingAccountDto(row),uses:await db.select().from(uses).where(eq(uses.account_id,row.id)).limit(100)})))
}
/** This family is not accepted by general account/agent authentication. */
export async function resolveSpendingAccount(request:NextRequest,orgId:string){
  const match=/^Bearer (cmos_[a-f0-9]{64})$/.exec(request.headers.get('authorization')||'')
  if(!match)return null
  const [row]=await db.select().from(accounts).where(and(eq(accounts.credential_hash,credentialHash(match[1])),eq(accounts.organization_id,orgId))).limit(1)
  if(!row)return null
  await current(row,db)
  return issueOrganizationSpendingEvidence({accountId:row.id,organizationId:orgId,buyerId:`user_agent_${row.buyer_agent_id}`,agentId:row.buyer_agent_id,credentialHash:row.credential_hash})
}
export async function validateSpendingPurchase(source:PurchasingSource,evidence:OrganizationSpendingEvidence,serviceId:string,buyerId:string,order:z.output<typeof serviceOrderInput>,totalMinor:number){
  if(!validOrganizationSpendingEvidence(evidence))throw new PurchasingError('SPENDING_CREDENTIAL_REQUIRED',401)
  const [row]=await source.select().from(accounts).where(and(eq(accounts.id,evidence.accountId),eq(accounts.credential_hash,evidence.credentialHash))).limit(1)
  if(!row||row.organization_id!==evidence.organizationId||buyerId!==evidence.buyerId||row.buyer_agent_id!==evidence.agentId)throw new PurchasingError('SPENDING_BUYER_SCOPE_CHANGED')
  writes();const allowed=await current(row,source)
  if(order.payment_rail!=='credit'||!order.purchasing_approval_id)throw new PurchasingError('SPENDING_EXACT_CREDIT_APPROVAL_REQUIRED')
  if(!allowed.some(service=>service.service_id===serviceId&&service.provider_share_id===(order.provider_share_id??null)))throw new PurchasingError('SPENDING_SERVICE_SCOPE_MISMATCH')
  if(!Number.isSafeInteger(totalMinor)||totalMinor<1)throw new PurchasingError('SPENDING_AMOUNT_INVALID')
  const invalid=await source.all(sql`SELECT u.order_id FROM organization_spending_uses u
    LEFT JOIN service_orders o ON o.id=u.order_id LEFT JOIN trades t ON t.id=u.trade_id
    LEFT JOIN organization_purchase_uses approval ON approval.order_id=o.id AND approval.approval_id=o.purchasing_approval_id
    WHERE u.account_id=${row.id} AND (o.id IS NULL OR t.id IS NULL OR approval.order_id IS NULL
      OR o.organization_spending_account_id IS NOT ${row.id} OR o.trade_id<>t.id
      OR u.authority_hash<>${row.authority_hash} OR u.buyer_id<>${buyerId} OR o.buyer_id<>${buyerId} OR t.buyer_id<>${buyerId}
      OR o.payment_rail<>'credit' OR t.payment_rail<>'credit' OR u.amount_minor<>CAST(ROUND(t.total_cost*100) AS INTEGER)
      OR approval.amount_minor<>u.amount_minor OR approval.trade_id<>t.id OR approval.buyer_id<>${buyerId}
      OR u.created_at<>o.created_at*1000) LIMIT 1`)
  const orphan=await source.all(sql`SELECT o.id FROM service_orders o WHERE o.organization_spending_account_id=${row.id}
    AND NOT EXISTS(SELECT 1 FROM organization_spending_uses u WHERE u.order_id=o.id AND u.trade_id=o.trade_id AND u.account_id=${row.id}) LIMIT 1`)
  if(invalid.length||orphan.length)throw new PurchasingError('SPENDING_USAGE_INVALID')
  const now=new Date(),day=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),month=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)
  const [usage]=await source.select({lifetime:sql<number>`COALESCE(SUM(${uses.amount_minor}),0)`,daily:sql<number>`COALESCE(SUM(CASE WHEN ${uses.created_at} >= ${day} THEN ${uses.amount_minor} ELSE 0 END),0)`,
    monthly:sql<number>`COALESCE(SUM(CASE WHEN ${uses.created_at} >= ${month} THEN ${uses.amount_minor} ELSE 0 END),0)`}).from(uses).where(eq(uses.account_id,row.id))
  for(const [limit,spent,code] of [[row.max_purchase_minor,0,'SPENDING_PURCHASE_LIMIT'],[row.max_daily_minor,Number(usage.daily),'SPENDING_DAILY_LIMIT'],
    [row.max_monthly_minor,Number(usage.monthly),'SPENDING_MONTHLY_LIMIT'],[row.max_lifetime_minor,Number(usage.lifetime),'SPENDING_LIFETIME_LIMIT']] as const){
    if(!Number.isSafeInteger(spent)||spent<0)throw new PurchasingError('SPENDING_USAGE_INVALID')
    if(spent+totalMinor>limit)throw new PurchasingError(code)
  }
  return {accountId:row.id,authorityHash:row.authority_hash,buyerId,totalMinor}
}
export async function consumeSpendingPurchase(source:PurchasingSource,validated:Awaited<ReturnType<typeof validateSpendingPurchase>>,orderId:string,tradeId:string,createdAt:Date){
  await source.insert(uses).values({account_id:validated.accountId,authority_hash:validated.authorityHash,buyer_id:validated.buyerId,amount_minor:validated.totalMinor,
    order_id:orderId,trade_id:tradeId,created_at:createdAt})
}
