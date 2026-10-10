import 'server-only'
import { spendingAuthorityHash } from './organization-spending-authority.mjs'
import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from './db'
import { agents, agent_owners, organizations, organization_agent_assignments, organization_teams,
  organization_spending_accounts as accounts, organization_spending_uses as uses, organization_audit_events, service_definitions, service_orders, trades } from './schema'
import { money, serviceOrderInput } from './service-order-input'
import { hashAgentApiKey } from './registered-agent-auth'
import { enterpriseFoundationEnabled } from './enterprise-foundation'
import { privateProviderAccess } from './organization-private-providers'
import { purchasingTransaction, PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'
import { routeMandatePaymentInput, paymentContract, RouteMandateError } from './route-payment-mandate'
import { canonicalContract } from './structured-verification'
import { issueOrganizationSpendingEvidence, validOrganizationSpendingEvidence, type OrganizationSpendingEvidence } from './organization-spending-evidence'

const reference=z.string().trim().min(8).max(200)
const allowedService=z.object({service_id:z.string().uuid(),provider_share_id:z.string().uuid().nullable()}).strict()
const creditAccountInput=z.object({version:z.literal(1),client_reference:reference,name:z.string().trim().min(1).max(120),
  buyer_agent_id:z.string().min(1).max(200),team_id:z.string().uuid().nullable(),cost_center:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),allowed_services:z.array(allowedService).min(1).max(20).refine(rows=>new Set(rows.map(row=>row.service_id)).size===rows.length),
  max_purchase:money,max_daily:money,max_monthly:money,max_lifetime:money,
  expires_at:z.string().datetime({offset:true}).transform(value=>new Date(value))}).strict()
const externalPayment=routeMandatePaymentInput.options[0].extend({chain_id:z.union([z.literal(1),z.literal(11155111)]),max_lifetime_gas_cost_wei:z.string().regex(/^[1-9][0-9]{0,77}$/)}).strict()
const tempoPayment=routeMandatePaymentInput.options[1].extend({chain_id:z.literal(4217),max_lifetime_fee_token_cost_units:z.string().regex(/^[1-9][0-9]{0,77}$/)}).strict()
export const spendingAccountInput=z.discriminatedUnion('version',[
  creditAccountInput,creditAccountInput.extend({version:z.literal(2),payment:externalPayment}).strict(),creditAccountInput.extend({version:z.literal(3),payment:tempoPayment}).strict(),
])
export const spendingExternalPaymentInput=externalPayment
export const spendingOrderInput=z.object({service_id:z.string().uuid(),order:serviceOrderInput}).strict()
type Account=typeof accounts.$inferSelect
const credentialHash=(key:string)=>hashAgentApiKey(`organization-spend:${key}`)
const live=(date:Date)=>Number.isFinite(date.getTime())&&date.getTime()>Date.now()
function writes(){if(!enterpriseFoundationEnabled())throw new PurchasingError('ORGANIZATION_SPENDING_DISABLED',503)}
function authority(row:Pick<Account,'organization_id'|'owner_account_id'|'buyer_agent_id'|'team_id'|'cost_center'|'client_reference'|'name'|'allowed_services_json'|'max_purchase_minor'|'max_daily_minor'|'max_monthly_minor'|'max_lifetime_minor'|'expires_at'> & {version?:number;payment_terms_json?:string|null}){
  return spendingAuthorityHash(row)
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
export async function currentSpendingAccount(row:Account,source:PurchasingSource){
  if(row.state!=='active'||!live(row.expires_at))throw new PurchasingError('SPENDING_ACCOUNT_INACTIVE',401)
  for(const limit of [row.max_purchase_minor,row.max_daily_minor,row.max_monthly_minor,row.max_lifetime_minor])if(!Number.isSafeInteger(limit)||limit<1||limit>100_000_000_000)throw new PurchasingError('SPENDING_AUTHORITY_INVALID')
  let allowed:z.output<typeof allowedService>[]
  try{allowed=creditAccountInput.shape.allowed_services.parse(JSON.parse(row.allowed_services_json));if(authority(row)!==row.authority_hash)throw Error('authority changed')}
  catch{throw new PurchasingError('SPENDING_AUTHORITY_INVALID')}
  if(row.version===1 ? row.payment_terms_json!==null : ![2,3].includes(row.version))throw new PurchasingError('SPENDING_AUTHORITY_INVALID')
  if(row.version>=2)spendingPaymentTerms(row)
  const assignment=await buyerScope(row.organization_id,row.owner_account_id,row.buyer_agent_id,source)
  if(assignment.team_id!==row.team_id||assignment.cost_center!==row.cost_center)throw new PurchasingError('SPENDING_BUYER_SCOPE_CHANGED')
  return allowed
}
export function spendingAccountDto(row:Account){
  return {version:row.version,id:row.id,organization_id:row.organization_id,buyer_agent_id:row.buyer_agent_id,team_id:row.team_id,cost_center:row.cost_center,name:row.name,
    allowed_services:JSON.parse(row.allowed_services_json),max_purchase:(row.max_purchase_minor/100).toFixed(2),max_daily:(row.max_daily_minor/100).toFixed(2),
    max_monthly:(row.max_monthly_minor/100).toFixed(2),max_lifetime:(row.max_lifetime_minor/100).toFixed(2),state:row.state,expires_at:row.expires_at,created_at:row.created_at,
    revoked_at:row.revoked_at,credential_prefix:row.credential_prefix,authority:row.version===3?'approved_direct_service_mpp' as const:row.version===2?'approved_direct_service_evm' as const:'approved_direct_service_credit' as const,
    ...(row.version>=2?{payment:spendingPaymentTerms(row).payment}: {})}
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
    const proposed={version:input.version,payment_terms_json:input.version===1?null:canonicalContract({payment:input.payment,...externalPaymentContract(input.payment)}),organization_id:orgId,owner_account_id:actor,buyer_agent_id:input.buyer_agent_id,team_id:assignment.team_id,cost_center:assignment.cost_center,
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
  await currentSpendingAccount(row,db)
  return issueOrganizationSpendingEvidence({accountId:row.id,organizationId:orgId,buyerId:`user_agent_${row.buyer_agent_id}`,agentId:row.buyer_agent_id,credentialHash:row.credential_hash})
}
export async function validateSpendingPurchase(source:PurchasingSource,evidence:OrganizationSpendingEvidence,serviceId:string,buyerId:string,order:Pick<z.output<typeof serviceOrderInput>,'payment_rail'|'purchasing_approval_id'|'provider_share_id'>,totalMinor:number,alreadyReserved=false){
  if(!validOrganizationSpendingEvidence(evidence))throw new PurchasingError('SPENDING_CREDENTIAL_REQUIRED',401)
  const [row]=await source.select().from(accounts).where(and(eq(accounts.id,evidence.accountId),eq(accounts.credential_hash,evidence.credentialHash))).limit(1)
  if(!row||row.organization_id!==evidence.organizationId||buyerId!==evidence.buyerId||row.buyer_agent_id!==evidence.agentId)throw new PurchasingError('SPENDING_BUYER_SCOPE_CHANGED')
  writes();const allowed=await currentSpendingAccount(row,source)
  if(order.payment_rail!==spendingRail(row)||!order.purchasing_approval_id)throw new PurchasingError(row.version>=2?'SPENDING_EXACT_EXTERNAL_APPROVAL_REQUIRED':'SPENDING_EXACT_CREDIT_APPROVAL_REQUIRED')
  if(!allowed.some(service=>service.service_id===serviceId&&service.provider_share_id===(order.provider_share_id??null)))throw new PurchasingError('SPENDING_SERVICE_SCOPE_MISMATCH')
  if(!Number.isSafeInteger(totalMinor)||totalMinor<1)throw new PurchasingError('SPENDING_AMOUNT_INVALID')
  const invalid=await source.all(sql`SELECT u.order_id FROM organization_spending_uses u
    LEFT JOIN service_orders o ON o.id=u.order_id LEFT JOIN trades t ON t.id=u.trade_id
    LEFT JOIN organization_purchase_uses approval ON approval.order_id=o.id AND approval.approval_id=o.purchasing_approval_id
    WHERE u.account_id=${row.id} AND (o.id IS NULL OR t.id IS NULL OR approval.order_id IS NULL
      OR o.organization_spending_account_id IS NOT ${row.id} OR o.trade_id<>t.id
      OR u.authority_hash<>${row.authority_hash} OR u.buyer_id<>${buyerId} OR o.buyer_id<>${buyerId} OR t.buyer_id<>${buyerId}
      OR o.payment_rail<>${spendingRail(row)} OR t.payment_rail<>o.payment_rail OR u.amount_minor<>CAST(ROUND(t.total_cost*100) AS INTEGER)
      OR approval.amount_minor<>u.amount_minor OR approval.trade_id<>t.id OR approval.buyer_id<>${buyerId}
      OR u.created_at<>o.created_at*1000) LIMIT 1`)
  const orphan=await source.all(sql`SELECT o.id FROM service_orders o WHERE o.organization_spending_account_id=${row.id}
    AND NOT EXISTS(SELECT 1 FROM organization_spending_uses u WHERE u.order_id=o.id AND u.trade_id=o.trade_id AND u.account_id=${row.id}) LIMIT 1`)
  if(invalid.length||orphan.length)throw new PurchasingError('SPENDING_USAGE_INVALID')
  const now=new Date(),day=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),month=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)
  const [usage]=await source.select({count:sql<number>`COUNT(*)`,lifetime:sql<number>`COALESCE(SUM(${uses.amount_minor}),0)`,daily:sql<number>`COALESCE(SUM(CASE WHEN ${uses.created_at} >= ${day} THEN ${uses.amount_minor} ELSE 0 END),0)`,
    monthly:sql<number>`COALESCE(SUM(CASE WHEN ${uses.created_at} >= ${month} THEN ${uses.amount_minor} ELSE 0 END),0)`}).from(uses).where(eq(uses.account_id,row.id))
  for(const [limit,spent,code] of [[row.max_purchase_minor,0,'SPENDING_PURCHASE_LIMIT'],[row.max_daily_minor,Number(usage.daily),'SPENDING_DAILY_LIMIT'],
    [row.max_monthly_minor,Number(usage.monthly),'SPENDING_MONTHLY_LIMIT'],[row.max_lifetime_minor,Number(usage.lifetime),'SPENDING_LIFETIME_LIMIT']] as const){
    if(!Number.isSafeInteger(spent)||spent<0)throw new PurchasingError('SPENDING_USAGE_INVALID')
    if(spent+(alreadyReserved&&code!=='SPENDING_PURCHASE_LIMIT'?0:totalMinor)>limit)throw new PurchasingError(code)
  }
  if(row.version>=2){const payment=spendingPaymentTerms(row).payment
    const count=Number(usage.count)+(alreadyReserved?0:1)
    if(!Number.isSafeInteger(count)||count<1)throw new PurchasingError('SPENDING_USAGE_INVALID')
    if(payment.rail==='evm'?BigInt(count)*BigInt(payment.max_gas_cost_wei)>BigInt(payment.max_lifetime_gas_cost_wei)
      :BigInt(count)*BigInt(payment.max_fee_token_cost_units)>BigInt(payment.max_lifetime_fee_token_cost_units))throw new PurchasingError(payment.rail==='evm'?'SPENDING_GAS_LIFETIME_LIMIT':'SPENDING_FEE_LIFETIME_LIMIT')
    const frozen=spendingPaymentTerms(row),configured=externalPaymentContract(payment)
    if(frozen.token_decimals!==configured.token_decimals||frozen.token_usd_price!==configured.token_usd_price)throw new PurchasingError('SPENDING_PAYMENT_TERMS_MISMATCH')
  }
  return {accountId:row.id,authorityHash:row.authority_hash,buyerId,totalMinor}
}
export async function consumeSpendingPurchase(source:PurchasingSource,validated:Awaited<ReturnType<typeof validateSpendingPurchase>>,orderId:string,tradeId:string,createdAt:Date){
  await source.insert(uses).values({account_id:validated.accountId,authority_hash:validated.authorityHash,buyer_id:validated.buyerId,amount_minor:validated.totalMinor,
    order_id:orderId,trade_id:tradeId,created_at:createdAt})
}

function externalPaymentContract(payment:z.output<typeof externalPayment>|z.output<typeof tempoPayment>){
  const terms=payment.rail==='evm'?externalPayment.omit({max_lifetime_gas_cost_wei:true}).parse(paymentWithoutLifetime(payment)):tempoPayment.omit({max_lifetime_fee_token_cost_units:true}).parse(paymentWithoutLifetime(payment))
  try{return paymentContract(terms)}catch(error){if(error instanceof RouteMandateError)throw new PurchasingError(error.code);throw error}
}
export function spendingPaymentTerms(row:Account){
  try{
    if(![2,3].includes(row.version)||authority(row)!==row.authority_hash)throw Error('invalid grant')
    const raw=JSON.parse(row.payment_terms_json!),payment=row.version===2?externalPayment.parse(raw.payment):tempoPayment.parse(raw.payment)
    if(canonicalContract({payment,token_decimals:raw.token_decimals,token_usd_price:raw.token_usd_price,...(payment.rail==='mpp'?{fee_token_decimals:raw.fee_token_decimals}:{})})!==row.payment_terms_json
      ||payment.rail==='mpp'&&raw.fee_token_decimals!==6||!Number.isInteger(raw.token_decimals)||raw.token_decimals<0||raw.token_decimals>36||!Number.isFinite(raw.token_usd_price)||raw.token_usd_price<=0)throw Error('invalid terms')
    return {payment,token_decimals:raw.token_decimals as number,token_usd_price:raw.token_usd_price as number}
  }catch{throw new PurchasingError('SPENDING_AUTHORITY_INVALID')}
}
/** Stored original linkage is inspectable after revocation; it grants no fresh send. */
export async function originalSpendingPayment(source:PurchasingSource,tradeId:string){
  const [order]=await source.select().from(service_orders).where(eq(service_orders.trade_id,tradeId)).limit(1)
  if(!order?.organization_spending_account_id)return null
  const [account]=await source.select().from(accounts).where(eq(accounts.id,order.organization_spending_account_id)).limit(1)
  const [use]=await source.select().from(uses).where(eq(uses.order_id,order.id)).limit(1)
  const [trade]=await source.select().from(trades).where(eq(trades.id,tradeId)).limit(1)
  if(!account||!use||!trade||use.account_id!==account.id||use.trade_id!==tradeId||use.authority_hash!==account.authority_hash
    ||trade.buyer_id!==use.buyer_id||order.buyer_id!==use.buyer_id||use.amount_minor!==Math.round(trade.total_cost*100))throw new PurchasingError('SPENDING_USAGE_INVALID')
  return {account,order,use,trade,...(account.version>=2?spendingPaymentTerms(account):{})}
}
export async function spendingFundingEligibility(trade:typeof trades.$inferSelect,source:PurchasingSource=db,
  actual?:{rail:string;chainId:number;tokenAddress:string;payerAddress:string;treasuryAddress?:string}){
  try{
    const original=await originalSpendingPayment(source,trade.id)
    if(!original)return null
    const {account,order}=original
    if(account.version<2)return 'SPENDING_EXACT_CREDIT_APPROVAL_REQUIRED'
    const {payment}=spendingPaymentTerms(account)
    const evidence=issueOrganizationSpendingEvidence({accountId:account.id,organizationId:account.organization_id,buyerId:trade.buyer_id,agentId:account.buyer_agent_id,credentialHash:account.credential_hash})
    await validateSpendingPurchase(source,evidence,order.service_id,trade.buyer_id,{payment_rail:order.payment_rail,purchasing_approval_id:order.purchasing_approval_id!,provider_share_id:order.private_provider_share_id??undefined},Math.round(trade.total_cost*100),true)
    if(actual&&(actual.rail!==payment.rail||actual.chainId!==payment.chain_id||actual.tokenAddress.toLowerCase()!==payment.token_address
      ||actual.payerAddress.toLowerCase()!==payment.payer_address||actual.treasuryAddress&&actual.treasuryAddress.toLowerCase()!==payment.treasury_address))return 'SPENDING_PAYMENT_TERMS_MISMATCH'
    return null
  }catch(error){if(error instanceof PurchasingError)return error.code;throw error}
}

function spendingRail(row:Account){return row.version===1?'credit':spendingPaymentTerms(row).payment.rail}
function paymentWithoutLifetime(payment:z.output<typeof externalPayment>|z.output<typeof tempoPayment>){
  if(payment.rail==='evm'){const {max_lifetime_gas_cost_wei:_,...terms}=payment;return terms}
  const {max_lifetime_fee_token_cost_units:_,...terms}=payment;return terms
}
